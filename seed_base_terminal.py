import MetaTrader5 as mt5
import sys
import time
import subprocess

path = r"C:\Program Files\Crib Markets MT5 Terminal\terminal64.exe"
print("Launching Base Terminal in portable mode to seed the server .srv file...")

subprocess.run(["taskkill", "/F", "/IM", "terminal64.exe", "/T"], capture_output=True)
time.sleep(2)

print("Attempting to initialize and connect using the MT5 API...")
# We use portable=True so it writes the .srv file INSIDE C:\Program Files\... instead of AppData
res = mt5.initialize(path=path, login=727272, password="Symbol@1234", server="CribMarket", portable=True, timeout=15000)

if not res:
    print(f"Failed to auto-seed via mt5.initialize: {mt5.last_error()}")
    mt5.shutdown()
    sys.exit(1)

print("SUCCESS: Base terminal connected and downloaded server data.")
print(mt5.account_info())
mt5.shutdown()
