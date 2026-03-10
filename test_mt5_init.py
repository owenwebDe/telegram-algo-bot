import MetaTrader5 as mt5
import sys

path = r"C:\mt5_instances\user_1\terminal64.exe"
print(f'Initializing MT5 at {path}')
# Use full server name CribMarket-Live to see if MT5 auto-downloads it without prompting
res = mt5.initialize(path=path, login=727272, password="Symbol@1234", server="CribMarket-Live", portable=True, timeout=15000)
if not res:
    print(f'Failed: {mt5.last_error()}')
    mt5.shutdown()
    sys.exit(1)

print('Success!')
print(mt5.account_info())
mt5.shutdown()
