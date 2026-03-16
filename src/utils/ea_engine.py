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

def place_pair(sym1: str, sym2: str, lot: float, sl_pips: float, tp_pips: float, magic: int, is_buy: bool, level_key: str, spread: float, deviation: int = 10) -> bool:
    """Executes a pair of trades simultaneously and tracks latency."""
    start_time = time.time()
    
    # 1. Determine local types
    type1 = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
    type2 = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY
    
    # 2. Prepare requests
    def get_req(sym, order_type):
        tick = mt5.symbol_info_tick(sym)
        if not tick: return None
        price = tick.ask if order_type == mt5.ORDER_TYPE_BUY else tick.bid
        point = mt5.symbol_info(sym).point
        sl = 0.0
        tp = 0.0
        if sl_pips:
            sl = (price - sl_pips * 10 * point) if order_type == mt5.ORDER_TYPE_BUY else (price + sl_pips * 10 * point)
        if tp_pips:
            tp = (price + tp_pips * 10 * point) if order_type == mt5.ORDER_TYPE_BUY else (price - tp_pips * 10 * point)
            
        return {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": sym,
            "volume": lot,
            "type": order_type,
            "price": price,
            "sl": sl,
            "tp": tp,
            "magic": magic,
            "deviation": deviation,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }

    req1 = get_req(sym1, type1)
    req2 = get_req(sym2, type2)
    
    if not req1 or not req2:
        log_frontend("error", "Failed to get symbol ticks for pair entry")
        return False

    # 3. Synchronized Execution
    res1 = mt5.order_send(req1)
    res2 = mt5.order_send(req2)
    
    end_time = time.time()
    latency_ms = int((end_time - start_time) * 1000)
    
    t1 = res1.order if (res1 and res1.retcode == mt5.TRADE_RETCODE_DONE) else -1
    t2 = res2.order if (res2 and res2.retcode == mt5.TRADE_RETCODE_DONE) else -1
    
    if t1 != -1 and t2 != -1:
        pair_id = f"P_{int(time.time()*1000)}"
        new_pair = TradePair(pair_id, t1, t2, level_key, spread, lot)
        active_pairs.append(new_pair)
        
        # Determine exact level and diff targets for logging
        try:
            parts = level_key.split(".")
            base_lvl = parts[0]
        except:
            base_lvl = level_key

        trade_type_str = "Buy" if is_buy else "Sell"
        log_frontend("trade", f"Level = {base_lvl} Difference to Place Trade = {spread} Current Difference = {spread}")
        log_frontend("trade", f"{trade_type_str} Trade Placed: {t1} {t2}")
        log_frontend("trade", f"Trade Ticket {t1} {t2} Of lvl {base_lvl} Is Added to Struct Array Size = {len(active_pairs)}", latency_ms)
        return True
    
    if t1 != -1:
        pass # mt5.Close() does not exist, would need to manually reverse build
    if t2 != -1:
        pass
        
    res1_code = res1.retcode if res1 else 'None'
    res2_code = res2.retcode if res2 else 'None'
    log_frontend("error", f"Error in placing Buy/Sell Trade: R1={res1_code}, R2={res2_code}")
    return False

def close_pair(pair: TradePair, sym1: str, sym2: str, magic: int):
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
    if p1 and len(p1) > 0: close_pos(p1[0])
    if p2 and len(p2) > 0: close_pos(p2[0])
    latency_ms = int((time.time() - start_time) * 1000)
    
    pair.status = "CLOSED"
    log_frontend("trade", f"Order Closed by close_trade_place_on_that_level(). Ticket: {pair.t1} {pair.t2}", latency_ms)


def run(path: str, login: str, config: dict):
    global active_pairs
    trade_type        = config.get("tradeType", "buy")          # "buy" | "sell"
    symbol1           = config.get("symbol1", "XAUUSD")
    symbol2           = config.get("symbol2", "XAUUSD")
    magic_no          = int(config.get("magicNo", 12345))
    stop_loss         = float(config.get("stopLoss", 0))
    take_profit       = float(config.get("takeProfit", 0))
    symbol_to_trade   = config.get("symbolToTrade", "Sym1")     # "Sym1" | "Sym2"
    symbol_to_close   = config.get("symbolToClose", "Sym1")
    cfg_trade_on_same_level = bool(config.get("tradeOnSameLevel", False))
    slippage          = int(config.get("slippage", 1))
    deviation         = slippage * 10  # convert pips to points
    levels            = config.get("levels", [])               # list of level dicts

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
        gold_spot_detected = None
        gold_future_detected = None

        # First preference: visible symbols in Market Watch
        for s in all_symbols:
            name = s.name.upper()
            if not s.visible:
                continue
            if (name == "XAUUSD" or name == "GOLD") and gold_spot_detected is None:
                gold_spot_detected = s.name
            elif ((name.startswith("XAUUSD") and name != "XAUUSD") or (name.startswith("GOLD") and name != "GOLD")) and gold_future_detected is None:
                gold_future_detected = s.name

        # Second preference: search ALL symbols if still missing
        if gold_spot_detected is None or gold_future_detected is None:
            for s in all_symbols:
                name = s.name.upper()
                if (name == "XAUUSD" or name == "GOLD") and gold_spot_detected is None:
                    gold_spot_detected = s.name
                elif ((name.startswith("XAUUSD") and name != "XAUUSD") or (name.startswith("GOLD") and name != "GOLD")) and gold_future_detected is None:
                    gold_future_detected = s.name

        # Override config symbols with detected ones
        if gold_spot_detected and gold_future_detected:
            symbol1 = gold_future_detected   # Forex Gold (future)
            symbol2 = gold_spot_detected     # Spot Gold
            log_frontend("info", f"Auto-detected symbols: {symbol1} (future) / {symbol2} (spot)")
        elif gold_spot_detected:
            log_frontend("info", f"Only found spot: {gold_spot_detected}, no future detected")
        elif gold_future_detected:
            log_frontend("info", f"Only found future: {gold_future_detected}, no spot detected")

    # Ensure symbols are in Market Watch, otherwise tick queries return None
    mt5.symbol_select(symbol1, True)
    mt5.symbol_select(symbol2, True)

    print(json.dumps({"type": "started", "login": str(account_info.login), "balance": account_info.balance}), flush=True)

    # ── Stdin watcher thread ────────────────────────────────────────────────
    t = threading.Thread(target=stdin_watcher, daemon=True)
    t.start()

    last_heartbeat = 0.0
    PROCESS_INTERVAL_MS = 0.020  # Fast polling for precision
    
    last_spread = 0.0
    spread_dir = "stable"
    MAX_ACTIVE_TRADES = int(config.get("maxActiveTrades", 5))

    # ── Main Loop ───────────────────────────────────────────────────────────
    while not _stop_flag.is_set():
        now = time.time()

        tick1 = mt5.symbol_info_tick(symbol1)
        tick2 = mt5.symbol_info_tick(symbol2)

        is_buy = (trade_type == "buy")
        diff_open = 0.0
        diff_close = 0.0

        if tick1 and tick2:
            ask1_minus_bid2 = normalize(tick1.ask - tick2.bid, 2)
            bid1_minus_ask2 = normalize(tick1.bid - tick2.ask, 2)
            
            if is_buy:
                diff_open = ask1_minus_bid2
                diff_close = bid1_minus_ask2
            else:
                diff_open = bid1_minus_ask2
                diff_close = ask1_minus_bid2
            
            if diff_open > last_spread: spread_dir = "widening"
            elif diff_open < last_spread: spread_dir = "narrowing"
            
            last_spread = diff_open

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
                    
                    if diff_to_trade_val == 0:
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

        # ── Determine symbol order ───────────────────────────────────────
        open_sym1 = symbol1 if symbol_to_trade == "Sym1" else symbol2
        open_sym2 = symbol2 if symbol_to_trade == "Sym1" else symbol1
        close_sym1 = symbol1 if symbol_to_close == "Sym1" else symbol2
        close_sym2 = symbol2 if symbol_to_close == "Sym1" else symbol1

        # ── Place Logic ──────────────────────────────────────────────────
        current_active_pair_count = sum(1 for p in active_pairs if p.status == "OPEN")

        for i, lvl in enumerate(levels):
            l1_lot = float(levels[0].get("initialLot", 0.1)) if levels else 0.1
            num_pairs = int(lvl.get("numPairs", 0))
            if num_pairs <= 0: continue

            targets = [{"trade": float(lvl.get("diffToTrade", 0)), "cut": float(lvl.get("diffToCut", 0)), "sub_id": 0}]

            for t in targets:
                diff_to_trade = t["trade"]
                if diff_to_trade == 0: continue
                
                level_key = f"{i}.{t['sub_id']}"
                
                should_open = (is_buy and diff_open < diff_to_trade) or \
                              (not is_buy and diff_open > diff_to_trade)

                if should_open:
                    active_on_level = count_open_on_level(level_key)
                    if active_on_level >= num_pairs:
                        continue
                    
                    if current_active_pair_count >= MAX_ACTIVE_TRADES:
                        continue

                    remaining = num_pairs - active_on_level
                    for _ in range(remaining):
                        if current_active_pair_count < MAX_ACTIVE_TRADES:
                            if place_pair(open_sym1, open_sym2, l1_lot, stop_loss, take_profit, magic_no, is_buy, level_key, diff_open, deviation):
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

            if diff_to_cut == 0: continue

            should_close = (is_buy and diff_close > diff_to_cut) or \
                           (not is_buy and diff_close < diff_to_cut)

            if should_close:
                close_pair(p, close_sym1, close_sym2, magic_no)

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
