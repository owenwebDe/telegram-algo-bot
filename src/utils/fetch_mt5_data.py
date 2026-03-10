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

    # Get prices for symbols in positions + main symbols
    symbols_to_check = list(set([p.symbol for p in positions] if positions else []) | {"EURUSD", "GBPUSD", "XAUUSD", "BTCUSD"})
    prices = {}
    for sym in symbols_to_check:
        tick = mt5.symbol_info_tick(sym)
        if tick:
            prices[sym] = {
                "bid": tick.bid,
                "ask": tick.ask,
                "last": tick.last if tick.last != 0 else tick.bid
            }

    data = {
        "status": "success",
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
