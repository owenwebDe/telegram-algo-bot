import MetaTrader5 as mt5
import sys
import json
import time
import argparse

def fetch_data(terminal_path=None, expected_login=None):
    init_params = {}
    if terminal_path:
        init_params["path"] = terminal_path
    
    # We always use a timeout to prevent hanging
    init_params["timeout"] = 30000

    if not mt5.initialize(**init_params):
        print(json.dumps({
            "status": "failed",
            "message": f"initialize() failed, error code: {mt5.last_error()}"
        }))
        return

    # Account info
    account_info = mt5.account_info()
    if account_info is None:
        print(json.dumps({
            "status": "failed",
            "message": "Failed to get account info"
        }))
        mt5.shutdown()
        return

    # Verify if we are on the right account if requested
    if expected_login and str(account_info.login) != str(expected_login):
        print(json.dumps({
            "status": "failed",
            "message": f"Connected to wrong account. Expected {expected_login}, got {account_info.login}"
        }))
        mt5.shutdown()
        return

    # Get open positions
    positions = mt5.positions_get()
    positions_list = []
    if positions:
        for p in positions:
            positions_list.append({
                "ticket": p.ticket,
                "symbol": p.symbol,
                "type": "BUY" if p.type == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": p.volume,
                "price_open": p.price_open,
                "price_current": p.price_current,
                "profit": p.profit,
                "magic": p.magic,
                "comment": p.comment
            })

    # Debug: list some symbols to stderr
    all_symbols = mt5.symbols_get()
    if all_symbols:
        sys.stderr.write(f"DEBUG: Found {len(all_symbols)} total symbols\n")
        # Log first 10 gold-like symbols if any
        gold_finds = [s.name for s in all_symbols if "GOLD" in s.name.upper() or "XAU" in s.name.upper()]
        sys.stderr.write(f"DEBUG: Gold-like symbols found: {gold_finds[:10]}\n")

    # Auto-detect gold spot and future symbols
    gold_spot = None
    gold_future = None
    visible_symbols = []
    if all_symbols:
        for s in all_symbols:
            if s.visible:
                visible_symbols.append(s.name)
            
            name = s.name.upper()
            # First preference: ones already visible/in market watch
            if not s.visible: continue
            if (name == "XAUUSD" or name == "GOLD") and gold_spot is None:
                gold_spot = s.name
            elif ((name.startswith("XAUUSD") and name != "XAUUSD") or (name.startswith("GOLD") and name != "GOLD")) and gold_future is None:
                gold_future = s.name
        
        # Second preference: search all if still missing
        if gold_spot is None or gold_future is None:
            for s in all_symbols:
                name = s.name.upper()
                if (name == "XAUUSD" or name == "GOLD") and gold_spot is None:
                    gold_spot = s.name
                    mt5.symbol_select(gold_spot, True)
                elif ((name.startswith("XAUUSD") and name != "XAUUSD") or (name.startswith("GOLD") and name != "GOLD")) and gold_future is None:
                    gold_future = s.name
                    mt5.symbol_select(gold_future, True)

    # Get prices for symbols in positions + main symbols + detected + visible
    base_symbols = ["EURUSD", "GBPUSD", "XAUUSD", "XAUUSD.", "BTCUSD"]
    if gold_spot: base_symbols.append(gold_spot)
    if gold_future: base_symbols.append(gold_future)
    
    symbols_to_check = list(set([p.symbol for p in positions] if positions else []) | set(base_symbols) | set(visible_symbols))
    prices = {}
    for sym in symbols_to_check:
        tick = mt5.symbol_info_tick(sym)
        if tick:
            prices[sym] = {
                "bid": tick.bid,
                "ask": tick.ask,
                "last": tick.last if tick.last != 0 else tick.bid
            }
        else:
            # Try to select it if it's in our base list/detected but failed to tick
            if sym in base_symbols:
                if mt5.symbol_select(sym, True):
                    tick = mt5.symbol_info_tick(sym)
                    if tick:
                        prices[sym] = {
                            "bid": tick.bid,
                            "ask": tick.ask,
                            "last": tick.last if tick.last != 0 else tick.bid
                        }

    # Terminal info (for Algo Trading status)
    account_info = mt5.account_info()
    trade_allowed = account_info.trade_allowed if account_info else False

    data = {
        "status": "success",
        "terminal": {
            "trade_allowed": trade_allowed
        },
        "gold_symbols": {
            "spot": gold_spot,
            "future": gold_future
        },
        "account": {
            "login": account_info.login,
            "balance": account_info.balance,
            "equity": account_info.equity,
            "margin": account_info.margin,
            "profit": account_info.profit,
            "currency": account_info.currency
        },
        "positions": positions_list,
        "prices": prices,
        "server_time": time.time()
    }

    print(json.dumps(data))
    mt5.shutdown()

def fetch_history(terminal_path=None, expected_login=None, hours=24, magic=None):
    import datetime

    init_params = {"timeout": 30000}
    if terminal_path:
        init_params["path"] = terminal_path

    if not mt5.initialize(**init_params):
        print(json.dumps({"status": "failed", "message": f"initialize() failed: {mt5.last_error()}"}))
        return

    account_info = mt5.account_info()
    if account_info is None:
        print(json.dumps({"status": "failed", "message": "Failed to get account info"}))
        mt5.shutdown()
        return

    if expected_login and str(account_info.login) != str(expected_login):
        print(json.dumps({"status": "failed", "message": f"Wrong account. Expected {expected_login}, got {account_info.login}"}))
        mt5.shutdown()
        return

    date_to   = datetime.datetime.now()
    date_from = date_to - datetime.timedelta(hours=hours)

    raw_deals = mt5.history_deals_get(date_from, date_to)
    closing_deals = []

    if raw_deals:
        for d in raw_deals:
            # Skip balance/credit/bonus entries (type > 1)
            if d.type > 1:
                continue
            # Only closing (DEAL_ENTRY_OUT = 1) and in-out reversals (DEAL_ENTRY_INOUT = 2)
            if d.entry not in (1, 2):
                continue
            # Filter by magic if requested
            if magic is not None and d.magic != magic:
                continue
            closing_deals.append({
                "ticket":     d.ticket,
                "time":       d.time,
                "type":       "buy" if d.type == 0 else "sell",
                "symbol":     d.symbol,
                "volume":     d.volume,
                "price":      d.price,
                "commission": d.commission,
                "swap":       d.swap,
                "profit":     d.profit,
                "comment":    d.comment,
                "magic":      d.magic,
            })

    # Group into pairs: same comment + timestamps within 5 seconds
    pairs  = []
    used   = set()

    for i, d1 in enumerate(closing_deals):
        if i in used:
            continue
        matched_j = None
        for j, d2 in enumerate(closing_deals):
            if j == i or j in used:
                continue
            same_comment = d1["comment"] and d1["comment"] == d2["comment"]
            close_in_time = abs(d1["time"] - d2["time"]) <= 5
            diff_symbol   = d1["symbol"] != d2["symbol"]
            if same_comment and close_in_time and diff_symbol:
                matched_j = j
                break

        if matched_j is not None:
            d2 = closing_deals[matched_j]
            used.add(i)
            used.add(matched_j)
            total = round(
                d1["profit"] + d1["commission"] + d1["swap"] +
                d2["profit"] + d2["commission"] + d2["swap"], 2
            )
            raw_lvl = d1["comment"].replace("EA:", "") if d1["comment"].startswith("EA:") else d1["comment"]
            try:
                lvl_num = int(raw_lvl.split(".")[0]) + 1
                lvl_label = f"L{lvl_num}"
            except Exception:
                lvl_label = raw_lvl or "—"
            pairs.append({
                "time":    max(d1["time"], d2["time"]),
                "sym1":    d1["symbol"],
                "sym2":    d2["symbol"],
                "symbol":  f"{d1['symbol']} / {d2['symbol']}",
                "volume":  d1["volume"],
                "profit":  total,
                "level":   lvl_label,
                "comment": d1["comment"],
            })
        else:
            # Unpaired — show individually (orphan or SL/TP hit)
            used.add(i)
            total = round(d1["profit"] + d1["commission"] + d1["swap"], 2)
            raw_lvl = d1["comment"].replace("EA:", "") if d1["comment"].startswith("EA:") else d1["comment"]
            try:
                lvl_num = int(raw_lvl.split(".")[0]) + 1
                lvl_label = f"L{lvl_num}"
            except Exception:
                lvl_label = raw_lvl or "—"
            pairs.append({
                "time":    d1["time"],
                "sym1":    d1["symbol"],
                "sym2":    "",
                "symbol":  d1["symbol"],
                "volume":  d1["volume"],
                "profit":  total,
                "level":   lvl_label,
                "comment": d1["comment"],
            })

    pairs.sort(key=lambda x: x["time"], reverse=True)

    wins        = sum(1 for p in pairs if p["profit"] > 0)
    total_profit = round(sum(p["profit"] for p in pairs), 2)

    print(json.dumps({
        "status":       "success",
        "deals":        pairs,
        "total_profit": total_profit,
        "total_trades": len(pairs),
        "wins":         wins,
        "losses":       len(pairs) - wins,
    }))
    mt5.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--path",    help="Path to terminal64.exe")
    parser.add_argument("--login",   help="Expected account login")
    parser.add_argument("--history", action="store_true", help="Fetch closed trade history")
    parser.add_argument("--hours",   type=int, default=24,  help="Number of hours back to fetch (default 24)")
    parser.add_argument("--magic",   type=int, default=None, help="Filter by EA magic number")
    args = parser.parse_args()

    if args.history:
        fetch_history(terminal_path=args.path, expected_login=args.login, hours=args.hours, magic=args.magic)
    else:
        fetch_data(terminal_path=args.path, expected_login=args.login)
