"""
ea_engine.py – Equivault FX Expert Advisor Engine

This script ports the MQL5 EA logic from myMT5.mq5 to Python, running as a
persistent background process that connects to an active MT5 terminal via IPC.

Usage:
    python ea_engine.py --path <terminal_exe> --login <account_login> \
                        --config '<json_string>'

The config JSON matches the ea_configs schema:
{
    "tradeType": "buy",           # "buy" | "sell"
    "symbol1": "XAUUSD",
    "symbol2": "XAUUSD.",
    "initialLot": 0.1,
    "magicNo": 12345,
    "stopLoss": 0,
    "takeProfit": 0,
    "symbolToTrade": "Sym1",      # "Sym1" | "Sym2"
    "symbolToClose": "Sym1",
    "tradeOnSameLevel": false,
    "levels": [
        {"diffToTrade": 2.4, "diffToCut": 2.0, "numPairs": 1},
        {"diffToTrade": 2.8, "diffToCut": 2.4, "numPairs": 1}
    ]
}

The engine writes heartbeat JSON lines to stdout every second:
{
    "type": "heartbeat",
    "running": true,
    "spread_buy": 2.41,
    "spread_sell": -1.21,
    "active_levels": [0, 2],
    "open_pairs": 4,
    "ea_profit": 123.50
}

Send "STOP\n" to stdin to shut down cleanly.
"""

import MetaTrader5 as mt5
import sys
import json
import time
import argparse
import threading
import select


# ─── Order tracking structure ─────────────────────────────────────────────────
# Mirrors od_1[orderNum] from the MQL5 EA
MAX_LEVELS = 11

class LevelRecord:
    def __init__(self):
        self.tickets: list[int] = []
        self.level: int = -1


order_records: list[LevelRecord] = [LevelRecord() for _ in range(MAX_LEVELS)]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def normalize(val: float, digits: int = 2) -> float:
    return round(val, digits)


def place_buy(symbol: str, lot: float, sl_pips: float, tp_pips: float, magic: int, deviation: int = 10) -> int:
    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        return -1
    price = tick.ask
    point = mt5.symbol_info(symbol).point
    sl = (price - sl_pips * 10 * point) if sl_pips else 0.0
    tp = (price + tp_pips * 10 * point) if tp_pips else 0.0
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lot,
        "type": mt5.ORDER_TYPE_BUY,
        "price": price,
        "sl": sl,
        "tp": tp,
        "magic": magic,
        "deviation": deviation,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    result = mt5.order_send(req)
    if result and result.retcode == mt5.TRADE_RETCODE_DONE:
        return result.order
    print(json.dumps({"type": "error", "msg": f"Buy failed on {symbol}: {result}"}), flush=True)
    return -1


def place_sell(symbol: str, lot: float, sl_pips: float, tp_pips: float, magic: int, deviation: int = 10) -> int:
    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        return -1
    price = tick.bid
    point = mt5.symbol_info(symbol).point
    sl = (price + sl_pips * 10 * point) if sl_pips else 0.0
    tp = (price - tp_pips * 10 * point) if tp_pips else 0.0
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lot,
        "type": mt5.ORDER_TYPE_SELL,
        "price": price,
        "sl": sl,
        "tp": tp,
        "magic": magic,
        "deviation": 10,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    result = mt5.order_send(req)
    if result and result.retcode == mt5.TRADE_RETCODE_DONE:
        return result.order
    print(json.dumps({"type": "error", "msg": f"Sell failed on {symbol}: {result}"}), flush=True)
    return -1


def is_position_open(ticket: int) -> bool:
    positions = mt5.positions_get(ticket=ticket)
    return positions is not None and len(positions) > 0


def get_active_pair_count(record: LevelRecord) -> int:
    count = sum(1 for t in record.tickets if is_position_open(t))
    return count // 2  # pairs


def check_trade_on_level(level: int) -> bool:
    for r in order_records:
        if r.level == level and len(r.tickets) > 0:
            return True
    return False


def add_ticket_to_level(level: int, ticket: int):
    for r in order_records:
        if r.level == -1 or r.level == level:
            r.level = level
            r.tickets.append(ticket)
            break


def close_level(level: int, sym1: str, sym2: str, magic: int):
    """Close all trades at a given level, sym1 first then rest."""
    for r in order_records:
        if r.level != level or not r.tickets:
            continue
        # Close sym1 positions first
        for ticket in list(r.tickets):
            positions = mt5.positions_get(ticket=ticket)
            if not positions:
                continue
            pos = positions[0]
            if pos.symbol == sym1:
                req = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "symbol": pos.symbol,
                    "volume": pos.volume,
                    "type": mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY,
                    "position": ticket,
                    "price": mt5.symbol_info_tick(pos.symbol).bid if pos.type == 0 else mt5.symbol_info_tick(pos.symbol).ask,
                    "magic": magic,
                    "deviation": 10,
                    "type_filling": mt5.ORDER_FILLING_IOC,
                }
                mt5.order_send(req)

        # Then close remaining
        for ticket in list(r.tickets):
            positions = mt5.positions_get(ticket=ticket)
            if not positions:
                continue
            pos = positions[0]
            req = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": pos.symbol,
                "volume": pos.volume,
                "type": mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY,
                "position": ticket,
                "price": mt5.symbol_info_tick(pos.symbol).bid if pos.type == 0 else mt5.symbol_info_tick(pos.symbol).ask,
                "magic": magic,
                "deviation": 10,
                "type_filling": mt5.ORDER_FILLING_IOC,
            }
            mt5.order_send(req)

        if cfg_trade_on_same_level:
            r.tickets = []
            r.level = -1
        return


def get_ea_profit(magic: int, symbol1: str, symbol2: str) -> float:
    positions = mt5.positions_get()
    if not positions:
        return 0.0
    return sum(p.profit for p in positions
               if p.magic == magic and p.symbol in (symbol1, symbol2))


# ─── Main Trading Loop ────────────────────────────────────────────────────────

cfg_trade_on_same_level = False
_stop_flag = threading.Event()


def stdin_watcher():
    """Thread: watch stdin for STOP command."""
    for line in sys.stdin:
        if line.strip().upper() == "STOP":
            _stop_flag.set()
            return


def run(path: str, login: str, config: dict):
    global cfg_trade_on_same_level

    # Parse config
    trade_type        = config.get("tradeType", "buy")          # "buy" | "sell"
    symbol1           = config.get("symbol1", "XAUUSD")
    symbol2           = config.get("symbol2", "XAUUSD.")
    initial_lot       = float(config.get("initialLot", 0.1))
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

    print(json.dumps({"type": "started", "login": str(account_info.login), "balance": account_info.balance}), flush=True)

    # ── Stdin watcher thread ────────────────────────────────────────────────
    t = threading.Thread(target=stdin_watcher, daemon=True)
    t.start()

    last_heartbeat = 0.0
    PROCESS_INTERVAL_MS = 0.050  # 50ms

    # ── Main Loop ───────────────────────────────────────────────────────────
    while not _stop_flag.is_set():
        now = time.time()

        # ── Spread Calculation ───────────────────────────────────────────
        tick1 = mt5.symbol_info_tick(symbol1)
        tick2 = mt5.symbol_info_tick(symbol2)

        if not tick1 or not tick2:
            time.sleep(PROCESS_INTERVAL_MS)
            continue

        diff_open_buy   = normalize(tick1.ask - tick2.bid, 2)
        diff_open_sell  = normalize(tick1.bid - tick2.ask, 2)
        diff_close_buy  = normalize(tick1.bid - tick2.ask, 2)
        diff_close_sell = normalize(tick1.ask - tick2.bid, 2)

        is_buy = (trade_type == "buy")
        diff_open  = diff_open_buy  if is_buy else diff_open_sell
        diff_close = diff_close_buy if is_buy else diff_close_sell

        # ── Determine symbol order ───────────────────────────────────────
        open_sym1 = symbol1 if symbol_to_trade == "Sym1" else symbol2
        open_sym2 = symbol2 if symbol_to_trade == "Sym1" else symbol1
        close_sym1 = symbol1 if symbol_to_close == "Sym1" else symbol2
        close_sym2 = symbol2 if symbol_to_close == "Sym1" else symbol1

        # ── Place Logic ──────────────────────────────────────────────────
        for i, lvl in enumerate(levels):
            diff_to_trade = float(lvl.get("diffToTrade", 0))
            num_pairs     = int(lvl.get("numPairs", 0))
            if diff_to_trade == 0 or num_pairs == 0:
                continue

            should_open = (is_buy and diff_open < diff_to_trade) or \
                          (not is_buy and diff_open > diff_to_trade)

            if should_open and not check_trade_on_level(i):
                for _ in range(num_pairs):
                    if is_buy:
                        if symbol_to_trade == "Sym1":
                            t1 = place_buy(open_sym1, initial_lot, stop_loss, take_profit, magic_no, deviation)
                            t2 = place_sell(open_sym2, initial_lot, stop_loss, take_profit, magic_no, deviation)
                        else:
                            t2 = place_sell(open_sym2, initial_lot, stop_loss, take_profit, magic_no, deviation)
                            t1 = place_buy(open_sym1, initial_lot, stop_loss, take_profit, magic_no, deviation)
                    else:
                        if symbol_to_trade == "Sym1":
                            t1 = place_sell(open_sym1, initial_lot, stop_loss, take_profit, magic_no, deviation)
                            t2 = place_buy(open_sym2, initial_lot, stop_loss, take_profit, magic_no, deviation)
                        else:
                            t2 = place_buy(open_sym2, initial_lot, stop_loss, take_profit, magic_no, deviation)
                            t1 = place_sell(open_sym1, initial_lot, stop_loss, take_profit, magic_no, deviation)

                    if t1 != -1 and t2 != -1:
                        add_ticket_to_level(i, t1)
                        add_ticket_to_level(i, t2)

        # ── Close Logic ──────────────────────────────────────────────────
        for i, lvl in enumerate(levels):
            diff_to_cut = float(lvl.get("diffToCut", 0))
            if diff_to_cut == 0:
                continue

            should_close = (is_buy and diff_close > diff_to_cut) or \
                           (not is_buy and diff_close < diff_to_cut)

            if should_close:
                close_level(i, close_sym1, close_sym2, magic_no)

        # ── Heartbeat every 1s ───────────────────────────────────────────
        if now - last_heartbeat >= 1.0:
            last_heartbeat = now
            active_levels = [i for i, lvl in enumerate(levels)
                             if check_trade_on_level(i)]
            total_pairs = sum(get_active_pair_count(r) for r in order_records if r.level != -1)
            ea_profit = get_ea_profit(magic_no, symbol1, symbol2)
            
            # Check if Algo Trading is actually enabled in the terminal
            t_info = mt5.terminal_info()
            trade_allowed = t_info.trade_allowed if t_info else False

            print(json.dumps({
                "type": "heartbeat",
                "running": True,
                "terminal_trade_allowed": trade_allowed,
                "spread_buy": diff_open_buy,
                "spread_sell": diff_open_sell,
                "active_levels": active_levels,
                "open_pairs": total_pairs,
                "ea_profit": round(ea_profit, 2)
            }), flush=True)

        time.sleep(PROCESS_INTERVAL_MS)

    # ── Cleanup ──────────────────────────────────────────────────────────────
    print(json.dumps({"type": "stopped"}), flush=True)
    mt5.shutdown()


# ─── Entry Point ──────────────────────────────────────────────────────────────

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
