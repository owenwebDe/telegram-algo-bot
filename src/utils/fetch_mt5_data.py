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

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", help="Path to terminal64.exe")
    parser.add_argument("--login", help="Expected account login")
    args = parser.parse_args()
    
    fetch_data(terminal_path=args.path, expected_login=args.login)
