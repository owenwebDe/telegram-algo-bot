import MetaTrader5 as mt5
import sys
import json
import argparse
import time


def close_all(terminal_path=None, expected_login=None, magic=None):
    init_params = {"timeout": 30000}
    if terminal_path:
        init_params["path"] = terminal_path

    if not mt5.initialize(**init_params):
        print(json.dumps({"status": "failed", "message": f"MT5 initialize failed: {mt5.last_error()}"}))
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

    positions = mt5.positions_get()
    if not positions:
        print(json.dumps({"status": "success", "closed": 0, "failed": 0, "message": "No open positions"}))
        mt5.shutdown()
        return

    # Filter by magic if provided
    targets = [p for p in positions if magic is None or p.magic == magic]

    if not targets:
        print(json.dumps({"status": "success", "closed": 0, "failed": 0, "message": "No matching positions"}))
        mt5.shutdown()
        return

    closed = 0
    failed = 0
    errors = []

    for pos in targets:
        tick = mt5.symbol_info_tick(pos.symbol)
        if not tick:
            failed += 1
            errors.append(f"No tick for {pos.symbol}")
            continue

        close_type  = mt5.ORDER_TYPE_SELL if pos.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
        close_price = tick.bid if close_type == mt5.ORDER_TYPE_SELL else tick.ask

        # Detect filling mode
        sym_info = mt5.symbol_info(pos.symbol)
        fill_mode = mt5.ORDER_FILLING_IOC
        if sym_info:
            if sym_info.filling_mode & 1:
                fill_mode = mt5.ORDER_FILLING_FOK
            elif sym_info.filling_mode & 2:
                fill_mode = mt5.ORDER_FILLING_IOC
            else:
                fill_mode = mt5.ORDER_FILLING_RETURN

        req = {
            "action":       mt5.TRADE_ACTION_DEAL,
            "symbol":       pos.symbol,
            "volume":       pos.volume,
            "type":         close_type,
            "position":     pos.ticket,
            "price":        close_price,
            "deviation":    20,
            "magic":        pos.magic,
            "comment":      "CloseAll",
            "type_filling": fill_mode,
        }

        res = mt5.order_send(req)
        if res and res.retcode == mt5.TRADE_RETCODE_DONE:
            closed += 1
        else:
            # Retry with alternate filling modes
            retry_done = False
            for alt_fill in [mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN]:
                if alt_fill == fill_mode:
                    continue
                req_retry = dict(req)  # Copy the original dict
                req_retry["type_filling"] = alt_fill
                res2 = mt5.order_send(req_retry)
                if res2 and res2.retcode == mt5.TRADE_RETCODE_DONE:
                    closed += 1
                    retry_done = True
                    break
            if not retry_done:
                failed += 1
                code = res.retcode if res else "none"
                comment = res.comment if res else "no response"
                errors.append(f"ticket={pos.ticket} sym={pos.symbol} code={code} ({comment})")

        # Small delay between orders to avoid broker rejection
        time.sleep(0.1)

    mt5.shutdown()
    print(json.dumps({
        "status":  "success" if failed == 0 else "partial",
        "closed":  closed,
        "failed":  failed,
        "errors":  errors,
        "message": f"Closed {closed} position(s)" + (f", {failed} failed" if failed else ""),
    }))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--path",  help="Path to terminal64.exe")
    parser.add_argument("--login", help="Expected account login")
    parser.add_argument("--magic", type=int, default=None, help="Only close positions with this magic number")
    args = parser.parse_args()

    close_all(terminal_path=args.path, expected_login=args.login, magic=args.magic)
