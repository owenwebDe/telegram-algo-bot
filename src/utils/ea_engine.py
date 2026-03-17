import sys
import json
import time
import argparse
import threading
import MetaTrader5 as mt5

_stop_flag = threading.Event()

def stdin_watcher():
    for line in sys.stdin:
        if line.strip() == "stop":
            _stop_flag.set()
            break

def normalize(val: float, digits: int = 2) -> float:
    return round(val, digits)

MAX_LOG_HISTORY = 50
log_history = []

def log_frontend(msg_type: str, msg_text: str, latency_ms: int = None):
    global log_history
    ts = time.strftime('%H:%M:%S', time.gmtime())
    entry = {"time": ts, "type": msg_type, "msg": msg_text}
    if latency_ms is not None:
        entry["latency_ms"] = latency_ms
        
    log_history.append(entry)
    if len(log_history) > MAX_LOG_HISTORY:
        log_history.pop(0)
        
    out = {"type": msg_type, "msg": msg_text}
    if latency_ms is not None:
        out["latency_ms"] = latency_ms
    print(json.dumps(out), flush=True)


# ─── Order tracking structure ─────────────────────────────────────────────────
class TradePair:
    def __init__(self, key, ticket1, ticket2, level_key, spread, lot):
        self.key = key
        self.t1 = ticket1
        self.t2 = ticket2
        self.level_key = level_key
        self.spread = spread
        self.lot = lot
        self.status = "OPEN"

active_pairs: list[TradePair] = []

def count_open_on_level(level_key: str) -> int:
    """Count how many open pairs exist for a given level_key."""
    return sum(1 for p in active_pairs if p.status == "OPEN" and p.level_key == level_key)

def get_ea_profit(magic, sym1, sym2):
    profit = 0.0
    for p in active_pairs:
        if p.status == "OPEN":
            p1 = mt5.positions_get(ticket=p.t1)
            p2 = mt5.positions_get(ticket=p.t2)
            if p1 and len(p1) > 0: profit += p1[0].profit
            if p2 and len(p2) > 0: profit += p2[0].profit
    return profit

def get_symbol_filling(sym):
    """Detect the best filling mode for a symbol."""
    info = mt5.symbol_info(sym)
    if not info:
        return mt5.ORDER_FILLING_IOC
    filling = info.filling_mode
    if filling & 1:  # FOK
        return mt5.ORDER_FILLING_FOK
    if filling & 2:  # IOC
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN

def place_pair(symbol1: str, symbol2: str, sym_to_trade: str, lot: float, sl_pips: float, tp_pips: float, magic: int, is_buy: bool, level_key: str, spread: float, deviation: int = 10) -> bool:
    """Executes a pair of trades simultaneously and tracks latency."""
    start_time = time.time()
    
    # 1. Determine local types: BUY mode ALWAYS Buys Sym1, Sells Sym2
    type1 = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
    type2 = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY
    
    # 2. Prepare requests with correct filling mode per symbol
    def get_req(sym, order_type):
        tick = mt5.symbol_info_tick(sym)
        if not tick: return None
        price = tick.ask if order_type == mt5.ORDER_TYPE_BUY else tick.bid
        sym_info = mt5.symbol_info(sym)
        if not sym_info:
            return None
        point = sym_info.point
        sl = 0.0
        tp = 0.0
        if sl_pips:
            sl = (price - sl_pips * 10 * point) if order_type == mt5.ORDER_TYPE_BUY else (price + sl_pips * 10 * point)
        if tp_pips:
            tp = (price + tp_pips * 10 * point) if order_type == mt5.ORDER_TYPE_BUY else (price - tp_pips * 10 * point)
        
        fill_mode = get_symbol_filling(sym)
            
        return {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": sym,
            "volume": lot,
            "type": order_type,
            "price": price,
            "sl": sl,
            "tp": tp,
            "magic": magic,
            "comment": f"EA:{level_key}",
            "deviation": deviation,
            "type_filling": fill_mode,
        }

    req1 = get_req(symbol1, type1)
    req2 = get_req(symbol2, type2)
    
    if not req1 or not req2:
        log_frontend("error", "Failed to get symbol ticks for pair entry")
        return False

    # Log the requests for debugging
    type1_str = "BUY" if type1 == mt5.ORDER_TYPE_BUY else "SELL"
    type2_str = "BUY" if type2 == mt5.ORDER_TYPE_BUY else "SELL"
    log_frontend("info", f"Sending: {type1_str} {symbol1} fill={req1['type_filling']} | {type2_str} {symbol2} fill={req2['type_filling']}")

    # 3. Synchronized Execution based on SymbolToTrade config
    def send_with_retry(req):
        """Try to send order. If rejected due to filling, retry with alternate fill mode."""
        res = mt5.order_send(req)
        if res and res.retcode == mt5.TRADE_RETCODE_DONE:
            return res
        # If rejected, try alternate filling modes
        if res and res.retcode in (10030, 10016):
            for alt_fill in [mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN]:
                if alt_fill != req['type_filling']:
                    req_retry = dict(req)
                    req_retry['type_filling'] = alt_fill
                    res2 = mt5.order_send(req_retry)
                    if res2 and res2.retcode == mt5.TRADE_RETCODE_DONE:
                        return res2
        return res  # Return original failed result

    if sym_to_trade == "Sym1":
        res1 = send_with_retry(req1)
        res2 = send_with_retry(req2)
    else:
        res2 = send_with_retry(req2)
        res1 = send_with_retry(req1)
    
    end_time = time.time()
    latency_ms = int((end_time - start_time) * 1000)
    
    t1 = res1.order if (res1 and res1.retcode == mt5.TRADE_RETCODE_DONE) else -1
    t2 = res2.order if (res2 and res2.retcode == mt5.TRADE_RETCODE_DONE) else -1
    
    # Detailed per-trade logging
    log_frontend("info", f"Trade Results: {type1_str} {symbol1} → ticket={t1} code={res1.retcode if res1 else 'None'} ({res1.comment if res1 else ''}) | {type2_str} {symbol2} → ticket={t2} code={res2.retcode if res2 else 'None'} ({res2.comment if res2 else ''})")
    
    if t1 != -1 and t2 != -1:
        # POST-TRADE VERIFICATION: Wait 500ms and check if both positions STILL exist
        time.sleep(0.5)
        pos1_check = mt5.positions_get(ticket=t1)
        pos2_check = mt5.positions_get(ticket=t2)
        p1_alive = pos1_check is not None and len(pos1_check) > 0
        p2_alive = pos2_check is not None and len(pos2_check) > 0
        
        if not p1_alive or not p2_alive:
            log_frontend("error", f"POST-TRADE CHECK FAILED! {type1_str} {symbol1} alive={p1_alive}, {type2_str} {symbol2} alive={p2_alive}")
            # Close any surviving orphan
            if p1_alive and not p2_alive:
                log_frontend("error", f"Closing orphan {type1_str} {symbol1} ticket={t1}")
                p = pos1_check[0]
                tick = mt5.symbol_info_tick(p.symbol)
                if tick:
                    mt5.order_send({"action": mt5.TRADE_ACTION_DEAL, "symbol": p.symbol, "volume": p.volume, "type": mt5.ORDER_TYPE_SELL if p.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY, "position": p.ticket, "price": tick.bid if p.type == mt5.ORDER_TYPE_BUY else tick.ask, "magic": magic, "deviation": 10, "type_filling": get_symbol_filling(p.symbol)})
            if p2_alive and not p1_alive:
                log_frontend("error", f"Closing orphan {type2_str} {symbol2} ticket={t2}")
                p = pos2_check[0]
                tick = mt5.symbol_info_tick(p.symbol)
                if tick:
                    mt5.order_send({"action": mt5.TRADE_ACTION_DEAL, "symbol": p.symbol, "volume": p.volume, "type": mt5.ORDER_TYPE_SELL if p.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY, "position": p.ticket, "price": tick.bid if p.type == mt5.ORDER_TYPE_BUY else tick.ask, "magic": magic, "deviation": 10, "type_filling": get_symbol_filling(p.symbol)})
            return False
        
        # Both positions confirmed alive
        pair_id = f"P_{int(time.time()*1000)}"
        new_pair = TradePair(pair_id, t1, t2, level_key, spread, lot)
        active_pairs.append(new_pair)
        
        try:
            parts = level_key.split(".")
            base_lvl = parts[0]
        except:
            base_lvl = level_key

        trade_type_str = "Buy" if is_buy else "Sell"
        log_frontend("trade", f"Level = {base_lvl} Difference to Place Trade = {spread} Current Difference = {spread}")
        log_frontend("trade", f"{trade_type_str} Trade Placed: {t1} {t2}")
        log_frontend("trade", f"{type1_str} {symbol1} ticket={t1} | {type2_str} {symbol2} ticket={t2}")
        log_frontend("trade", f"Trade Ticket {t1} {t2} Of lvl {base_lvl} Is Added to Struct Array Size = {len(active_pairs)}", latency_ms)
        return True
    
    # --- Partial Failure Cleanup ---
    # If one trade opened but the other failed, we MUST close the orphan trade
    def close_orphan(ticket, label):
        pos = mt5.positions_get(ticket=ticket)
        if pos and len(pos) > 0:
            p = pos[0]
            tick = mt5.symbol_info_tick(p.symbol)
            if not tick:
                log_frontend("error", f"Partial failure: Could not get tick for {p.symbol} to close orphan {label}={ticket}")
                return
                
            close_pos_req = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": p.symbol,
                "volume": p.volume,
                "type": mt5.ORDER_TYPE_SELL if p.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY,
                "position": p.ticket,
                "price": tick.bid if p.type == mt5.ORDER_TYPE_BUY else tick.ask,
                "magic": magic,
                "deviation": 10,
                "type_filling": mt5.ORDER_FILLING_IOC,
            }
            res_c = mt5.order_send(close_pos_req)
            log_frontend("info", f"Partial failure cleanup: Orphan {label}={ticket} close request sent. Code={res_c.retcode if res_c else 'None'}")

    if t1 != -1 and t2 == -1:
        log_frontend("error", f"Partial failure: t1={t1} opened but t2 failed. Closing t1.")
        close_orphan(t1, "t1")

    if t2 != -1 and t1 == -1:
        log_frontend("error", f"Partial failure: t2={t2} opened but t1 failed. Closing t2.")
        close_orphan(t2, "t2")
        
    res1_ret = res1.retcode if res1 else "No Response"
    res2_ret = res2.retcode if res2 else "No Response"
    res1_err = res1.comment if res1 else "Unknown"
    res2_err = res2.comment if res2 else "Unknown"
    
    log_frontend("error", f"Trade Pairing Failed: R1={res1_ret} ({res1_err}), R2={res2_ret} ({res2_err})")
    return False

def close_pair(pair: TradePair, sym_to_close: str, magic: int):
    p1 = mt5.positions_get(ticket=pair.t1)
    p2 = mt5.positions_get(ticket=pair.t2)
    
    def close_pos(pos):
        tick = mt5.symbol_info_tick(pos.symbol)
        if not tick: return
        type_close = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
        price = tick.bid if type_close == mt5.ORDER_TYPE_SELL else tick.ask
        req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": type_close,
            "position": pos.ticket,
            "price": price,
            "magic": magic,
            "deviation": 10,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        mt5.order_send(req)

    start_time = time.time()
    
    if sym_to_close == "Sym1":
        if p1 and len(p1) > 0: close_pos(p1[0])
        if p2 and len(p2) > 0: close_pos(p2[0])
    else:
        if p2 and len(p2) > 0: close_pos(p2[0])
        if p1 and len(p1) > 0: close_pos(p1[0])
        
    latency_ms = int((time.time() - start_time) * 1000)
    
    pair.status = "CLOSED"
    log_frontend("trade", f"Order Closed by close_trade_place_on_that_level(). Ticket: {pair.t1} {pair.t2}", latency_ms)


def sync_active_pairs(magic: int, symbol1: str, symbol2: str):
    """Scan MT5 for existing positions with magic number and restore active_pairs."""
    global active_pairs
    positions = mt5.positions_get(magic=magic)
    if not positions:
        return

    # Group positions by comment (which contains the level_key)
    groups = {}
    for p in positions:
        comment = p.comment
        if not comment.startswith("EA:"):
            continue
        l_key = comment[3:]
        if l_key not in groups:
            groups[l_key] = []
        groups[l_key].append(p)

    for l_key, pos_list in groups.items():
        # A valid pair must have exactly 2 positions
        if len(pos_list) == 2:
            # We want to maintain some order, but for restoration it matters less
            p1, p2 = pos_list[0], pos_list[1]
            pair_id = f"P_{int(time.time()*1000)}_{l_key}"
            # Restore the TradePair object (spread is 0.0 as we don't know the exact entry spread at startup)
            new_pair = TradePair(pair_id, p1.ticket, p2.ticket, l_key, 0.0, p1.volume)
            active_pairs.append(new_pair)
            log_frontend("info", f"Restored Trade Pair: {p1.ticket} {p2.ticket} for Level {l_key}")
        else:
            # If we find 1 or >2 positions for a level_key, they are 'orphans' and should be closed
            # because they break the hedge strategy logic
            log_frontend("error", f"Found orphan positions for Level {l_key}. Group size={len(pos_list)}. Closing them for safety.")
            for p in pos_list:
                close_pos_req = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "symbol": p.symbol,
                    "volume": p.volume,
                    "type": mt5.ORDER_TYPE_SELL if p.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY,
                    "position": p.ticket,
                    "price": mt5.symbol_info_tick(p.symbol).bid if p.type == mt5.ORDER_TYPE_BUY else mt5.symbol_info_tick(p.symbol).ask,
                    "magic": magic,
                    "deviation": 10,
                    "type_filling": mt5.ORDER_FILLING_IOC,
                }
                mt5.order_send(close_pos_req)


def run(path: str, login: str, config: dict):
    global active_pairs
    trade_type        = config.get("tradeType", "buy")          # "buy" | "sell"
    # Always start with neutral defaults — auto-detection WILL override these
    symbol1           = "XAUUSD"
    symbol2           = "XAUUSD"
    magic_no          = int(config.get("magicNo", 12345))
    stop_loss         = float(config.get("stopLoss", 0))
    take_profit       = float(config.get("takeProfit", 0))
    symbol_to_trade   = config.get("symbolToTrade", "Sym1")     # "Sym1" | "Sym2"
    symbol_to_close   = config.get("symbolToClose", "Sym1")
    cfg_trade_on_same_level = bool(config.get("tradeOnSameLevel", False))
    slippage          = int(config.get("slippage", 1))
    deviation         = slippage * 10  # convert pips to points
    levels            = config.get("levels", [])               # list of level dicts
    
    locked_levels     = set() # Remembers closed levels if tradeOnSameLevel=False

    # ── MT5 Connection ──────────────────────────────────────────────────────
    init_result = mt5.initialize(path=path, timeout=30000) if path else mt5.initialize(timeout=30000)
    if not init_result:
        print(json.dumps({"type": "fatal", "msg": f"MT5 initialize failed: {mt5.last_error()}"}), flush=True)
        return

    account_info = mt5.account_info()
    if not account_info or str(account_info.login) != str(login):
        print(json.dumps({"type": "fatal", "msg": f"Wrong account. Expected {login}, got {account_info.login if account_info else 'None'}"}), flush=True)
        mt5.shutdown()
        return

    # ── Auto-detect gold spot and future symbols ───────────────────────────
    all_symbols = mt5.symbols_get()
    if all_symbols:
        # Pattern to identify futures (months or year numbers in the name)
        future_indicators = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", ".20", "-2" , "_F"]

        def detect_in_list(sym_list):
            spot, future = None, None
            for s in sym_list:
                name = s.name.upper()
                if not (name.startswith("XAUUSD") or name.startswith("GOLD")):
                    continue
                
                # Exclude non-USD pairs, Micro/Cent pairs
                if any(x in name for x in ["EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "USC", "MICRO", "CENT"]):
                    continue

                is_future = any(p in name for p in future_indicators)
                
                if is_future:
                    if future is None: 
                        future = s.name
                    else:
                        # Prefer GOLD futures over XAUUSD futures if both exist
                        if "GOLD" in name and "XAUUSD" in future.upper():
                            future = s.name
                        elif len(s.name) < len(future):
                            future = s.name
                else:
                    # Preference for spot: XAUUSD > GOLD > shortest name
                    if spot is None:
                        spot = s.name
                    else:
                        spot_upper = spot.upper()
                        # Exact matches are best
                        if name == "XAUUSD" or name == "GOLD":
                            spot = s.name
                        # XAUUSD-based names are preferred over GOLD for spot
                        elif "XAUUSD" in name and "XAUUSD" not in spot_upper:
                            spot = s.name
                        # Tie-breaker: shortest name (usually the cleanest symbol)
                        elif "XAUUSD" in name and "XAUUSD" in spot_upper and len(s.name) < len(spot):
                            spot = s.name
                        elif "GOLD" in name and "GOLD" in spot_upper and len(s.name) < len(spot):
                            spot = s.name

            return spot, future
        # First preference: Market Watch
        gold_spot_detected, gold_future_detected = detect_in_list([s for s in all_symbols if s.visible])

        # Second preference: All symbols
        if gold_spot_detected is None or gold_future_detected is None:
            s_s, s_f = detect_in_list(all_symbols)
            if gold_spot_detected is None: gold_spot_detected = s_s
            if gold_future_detected is None: gold_future_detected = s_f

        # Override config symbols with detected ones
        if gold_spot_detected and gold_future_detected:
            symbol1 = gold_future_detected   # Forex Gold (future)
            symbol2 = gold_spot_detected     # Spot Gold
            log_frontend("info", f"Auto-detected symbols: {symbol1} (future) / {symbol2} (spot)")
        elif gold_spot_detected:
            symbol2 = gold_spot_detected
            log_frontend("info", f"Detected only spot: {gold_spot_detected}")
        elif gold_future_detected:
            symbol1 = gold_future_detected
            log_frontend("info", f"Detected only future: {gold_future_detected}")

    # Ensure symbols are in Market Watch, otherwise tick queries return None
    mt5.symbol_select(symbol1, True)
    mt5.symbol_select(symbol2, True)

    # Log symbol trade capabilities
    for sym in [symbol1, symbol2]:
        si = mt5.symbol_info(sym)
        if si:
            # trade_mode: 0=disabled, 1=long_only, 2=short_only, 3=close_only, 4=full
            trade_mode_names = {0: "DISABLED", 1: "LONG_ONLY", 2: "SHORT_ONLY", 3: "CLOSE_ONLY", 4: "FULL"}
            filling_names = []
            if si.filling_mode & 1: filling_names.append("FOK")
            if si.filling_mode & 2: filling_names.append("IOC")
            if not filling_names: filling_names.append("RETURN")
            tm = trade_mode_names.get(si.trade_mode, f"UNKNOWN({si.trade_mode})")
            log_frontend("info", f"Symbol {sym}: trade_mode={tm}, filling=[{','.join(filling_names)}], spread={si.spread}")
            if si.trade_mode != 4:  # Not FULL
                log_frontend("error", f"WARNING: {sym} is NOT in FULL trade mode ({tm}). Trades may be rejected!")
        else:
            log_frontend("error", f"Cannot get symbol info for {sym}!")

    # Sync with existing positions on startup
    sync_active_pairs(magic_no, symbol1, symbol2)

    print(json.dumps({"type": "started", "login": str(account_info.login), "balance": account_info.balance}), flush=True)

    # ── Stdin watcher thread ────────────────────────────────────────────────
    t = threading.Thread(target=stdin_watcher, daemon=True)
    t.start()

    last_heartbeat = 0.0
    PROCESS_INTERVAL_MS = 0.020  # Fast polling for precision
    
    last_spread = 0.0
    spread_dir = "stable"
    MAX_ACTIVE_TRADES = int(config.get("maxActiveTrades", 5))

    last_diagnostic = 0.0

    # ── Main Loop ───────────────────────────────────────────────────────────
    while not _stop_flag.is_set():
        now = time.time()

        tick1 = mt5.symbol_info_tick(symbol1)
        tick2 = mt5.symbol_info_tick(symbol2)

        is_buy = (trade_type == "buy")
        diff_open_buy = 0.0
        diff_open_sell = 0.0
        diff_close_buy = 0.0
        diff_close_sell = 0.0

        diff_open = 0.0
        diff_close = 0.0

        if tick1 and tick2:
            ask1_minus_bid2 = normalize(tick1.ask - tick2.bid, 2)
            bid1_minus_ask2 = normalize(tick1.bid - tick2.ask, 2)
            
            # Exact MQL5 Spread Formulas
            diff_open_buy = ask1_minus_bid2
            diff_open_sell = bid1_minus_ask2
            diff_close_buy = bid1_minus_ask2
            diff_close_sell = ask1_minus_bid2
            
            # Keep standard heartbeat diff logic for dashboard graph tracking
            if is_buy:
                diff_open = diff_open_buy
                diff_close = diff_close_buy
            else:
                diff_open = diff_open_sell
                diff_close = diff_close_sell
            
            if diff_open > last_spread: spread_dir = "widening"
            elif diff_open < last_spread: spread_dir = "narrowing"
            
            last_spread = diff_open

        # ── Diagnostic Logging (Every 5s) ──────────────────────────────────
        if now - last_diagnostic >= 5.0:
            last_diagnostic = now
            if tick1 and tick2:
                for idx, lvl in enumerate(levels):
                    dt = float(lvl.get("diffToTrade", 0))
                    if dt > 0:
                        log_frontend("info", f"Check Lvl {idx+1}: Target={dt} Current={diff_open_buy if is_buy else diff_open_sell}")

        # ── Heartbeat every 500ms ─────────────────────────────────────────
        if now - last_heartbeat >= 0.5:
            last_heartbeat = now
            active_lvls = [p.level_key for p in active_pairs if p.status == "OPEN"]
            ea_profit = get_ea_profit(magic_no, symbol1, symbol2)
            
            t_info = mt5.account_info()
            trade_allowed = t_info.trade_allowed if t_info else False

            # Build level statuses for UI
            level_statuses = []
            for i, lvl in enumerate(levels):
                num_pairs = int(lvl.get("numPairs", 0))
                if num_pairs <= 0:
                    continue

                targets = [{"trade": float(lvl.get("diffToTrade", 0)), "cut": float(lvl.get("diffToCut", 0)), "sub_id": 0}]

                for t in targets:
                    diff_to_trade_val = t["trade"]
                    diff_to_cut_val = t["cut"]
                    sub_id = t["sub_id"]
                    
                    if num_pairs == 0:
                        continue
                    level_key = f"{i}.{sub_id}"
                    active_count = sum(1 for p in active_pairs if p.status == "OPEN" and p.level_key == level_key)
                    
                    level_statuses.append({
                        "level": i + 1,
                        "sub_id": sub_id,
                        "status": "Trade Opened" if active_count > 0 else "Waiting",
                        "difference": diff_open,
                        "placed": num_pairs,
                        "executed": active_count,
                        "max_pairs": num_pairs,
                        "trade_target": diff_to_trade_val,
                        "cut_target": diff_to_cut_val
                    })

            total_placed = sum(s["placed"] for s in level_statuses)
            total_executed = sum(s["executed"] for s in level_statuses)

            account_info = mt5.account_info()
            account_data = None
            if account_info is not None:
                account_data = {
                    "balance": account_info.balance,
                    "equity": account_info.equity,
                    "margin": account_info.margin,
                    "free_margin": account_info.margin_free,
                    "margin_level": account_info.margin_level
                }

            print(json.dumps({
                "type": "heartbeat",
                "running": True,
                "account": account_data,
                "terminal_trade_allowed": trade_allowed,
                "symbol1": symbol1,
                "symbol2": symbol2,
                "spread_buy": diff_open,
                "spread_sell": diff_close,
                "spread_dir": spread_dir,
                "active_levels": active_lvls,
                "open_pairs": len(active_lvls),
                "ea_profit": round(float(ea_profit), 2),
                "tick1": {"bid": tick1.bid, "ask": tick1.ask} if tick1 else None,
                "tick2": {"bid": tick2.bid, "ask": tick2.ask} if tick2 else None,
                "level_statuses": level_statuses,
                "tracker": {"executed": total_executed, "placed": total_placed},
                "active_trades": [
                    {"key": p.key, "level": p.level_key, "lot": p.lot, "spread": p.spread}
                    for p in active_pairs if p.status == "OPEN"
                ],
                "logs": list(log_history)
            }), flush=True)

        # Skip execution if we don't have ticks for both symbols
        if not tick1 or not tick2:
            time.sleep(PROCESS_INTERVAL_MS)
            continue

        # ── Place Logic ──────────────────────────────────────────────────
        current_active_pair_count = sum(1 for p in active_pairs if p.status == "OPEN")

        for i, lvl in enumerate(levels):
            l1_lot = float(levels[0].get("initialLot", 0.1)) if levels else 0.1
            num_pairs = int(lvl.get("numPairs", 0))
            if num_pairs <= 0: continue

            targets = [{"trade": float(lvl.get("diffToTrade", 0)), "cut": float(lvl.get("diffToCut", 0)), "sub_id": 0}]

            for t in targets:
                diff_to_trade = t["trade"]
                if diff_to_trade == 0.0:
                    continue
                
                level_key = f"{i}.{t['sub_id']}"
                
                # EA MQL5 Open Condition
                should_open = False
                if is_buy and diff_open_buy < diff_to_trade:
                    should_open = True
                elif not is_buy and diff_open_sell > diff_to_trade:
                    should_open = True

                if should_open:
                    if level_key in locked_levels:
                        continue
                        
                    # MQL5 Rule: ONLY open trades if there are currently NO existing trades on that level
                    active_on_level = count_open_on_level(level_key)
                    if active_on_level == 0:
                        if current_active_pair_count >= MAX_ACTIVE_TRADES:
                            continue

                        # Execute 'num_pairs' amount of pair trades simultaneously ONCE.
                        for _ in range(num_pairs):
                            if current_active_pair_count < MAX_ACTIVE_TRADES:
                                if place_pair(symbol1, symbol2, symbol_to_trade, l1_lot, stop_loss, take_profit, magic_no, is_buy, level_key, diff_open, deviation):
                                    current_active_pair_count += 1

        # ── Close Logic ──────────────────────────────────────────────────
        for p in active_pairs:
            if p.status != "OPEN": continue
            
            try:
                parts = p.level_key.split(".")
                l_idx = int(parts[0])
                sub_id = int(parts[1])
                lvl = levels[l_idx]
                diff_to_cut = float(lvl.get("diffToCut" if sub_id==0 else "diffToCut2", 0))
            except:
                continue
                
            if diff_to_cut == 0.0:
                continue

            # EA MQL5 Close Condition
            should_close = False
            if is_buy and diff_close_buy > diff_to_cut:
                should_close = True
            elif not is_buy and diff_close_sell < diff_to_cut:
                should_close = True

            if should_close:
                close_pair(p, symbol_to_close, magic_no)
                if not cfg_trade_on_same_level:
                    locked_levels.add(p.level_key)

        time.sleep(PROCESS_INTERVAL_MS)

    # ── Cleanup ──────────────────────────────────────────────────────────────
    print(json.dumps({"type": "stopped"}), flush=True)
    mt5.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Equivault EA Engine")
    parser.add_argument("--path", default="", help="Path to terminal64.exe")
    parser.add_argument("--login", required=True, help="MT5 account login")
    parser.add_argument("--config", required=True, help="JSON config string")
    args = parser.parse_args()

    try:
        config = json.loads(args.config)
    except json.JSONDecodeError as e:
        print(json.dumps({"type": "fatal", "msg": f"Invalid config JSON: {e}"}), flush=True)
        sys.exit(1)

    run(args.path, args.login, config)
