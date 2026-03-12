import MetaTrader5 as mt5
import sys
import json
import time
import subprocess
import os

def kill_terminal_by_path(exe_path):
    """Kills any process running the specific terminal executable."""
    try:
        target = os.path.normcase(os.path.abspath(exe_path))
        print(f"DEBUG: Aggressive targeted kill for {target}")
        
        # Robust case-insensitive search by path in PowerShell
        # We try to match both MainModule.FileName and Path
        script = f"""
        $target = '{target.replace("'", "''")}'
        Get-WmiObject Win32_Process -Filter "Name='terminal64.exe'" | ForEach-Object {{
            $path = $_.ExecutablePath
            if ($path -and ( ( [System.IO.Path]::GetFullPath($path).ToLower() -eq $target.ToLower() ) -or ( $path.ToLower() -eq $target.ToLower() ) ) ) {{
                Write-Host "DEBUG: Killing PID $($_.ProcessId) at $path"
                Stop-Process -Id $($_.ProcessId) -Force -ErrorAction SilentlyContinue
            }}
        }}
        """
        subprocess.run(['powershell', '-Command', script], capture_output=True)
        time.sleep(3) # Give Windows time to release file locks
        
    except Exception as e:
        print(f"DEBUG: Kill error: {str(e)}")
        print(f"DEBUG: Kill error: {str(e)}")

def launch_and_verify(path, login, timeout_ms, password, server):
    print(f"DEBUG: Starting launch_and_verify for {login} on {server}")
    # 1. Targeted Kill
    kill_terminal_by_path(path)
    time.sleep(2)

    instance_dir = os.path.dirname(os.path.abspath(path))
    # MT5 likes absolute paths for /config in many versions
    config_abs_path = os.path.abspath(os.path.join(instance_dir, "run", "startup.ini"))
    
    if not os.path.exists(config_abs_path):
        print(json.dumps({"status": "failed", "message": f"Config not found at {config_abs_path}"}))
        return

    # 3. Launch with /config
    # We use /portable to keep data within the instance dir
    config_arg = f"/config:{config_abs_path}"
    print(f"DEBUG: Spawning terminal: {path} /portable {config_arg}")
    try:
        # Using a list is generally safer on Windows with subprocess
        process = subprocess.Popen([path, "/portable", config_arg, "/experts:on"], cwd=instance_dir)
        print(f"DEBUG: Terminal spawned with PID {process.pid}")
    except Exception as e:
        print(json.dumps({"status": "failed", "message": f"Failed to spawn terminal: {str(e)}"}))
        return
    
    # 4. Wait for IPC
    initialized = False
    last_err = None
    # We wait up to timeout_ms, checking every second
    max_retries = int(timeout_ms / 1000) - 10 
    if max_retries < 15: max_retries = 30
    
    print(f"DEBUG: Waiting 5s for terminal to stabilize before IPC (max {max_retries}s)...")
    time.sleep(5)
    for i in range(max_retries):
        if mt5.initialize(path=path):
            initialized = True
            print(f"DEBUG: IPC connected on try {i+1}")
            break
        last_err = mt5.last_error()
        if i % 5 == 0 and i > 0:
            print(f"DEBUG: Still waiting... last_err={last_err}")
        time.sleep(1)

    if not initialized:
        print(json.dumps({
            "status": "failed",
            "message": f"mt5.initialize() failed to connect to IPC. Error: {last_err}"
        }))
        process.kill()
        return

    # 5. Check if already authorized via /config
    acc_info = mt5.account_info()
    if acc_info and str(acc_info.login) == str(login):
        print("DEBUG: Auto-login successful via /config")
    else:
        # 6. Explicit Login fallback
        print(f"DEBUG: Auto-login failed (Login={acc_info.login if acc_info else 'None'}). Trying explicit login...")
        try:
            login_int = int(login)
            # Short wait for terminal to be "ready" for login if config didn't kick in yet
            time.sleep(2)
            if not mt5.login(login_int, password, server):
                print(json.dumps({
                    "status": "failed",
                    "message": f"mt5.login() failed. Error: {mt5.last_error()}"
                }))
                mt5.shutdown()
                process.kill()
                return
        except ValueError:
            print(json.dumps({
                "status": "failed",
                "message": f"Invalid login format: {login}"
            }))
            mt5.shutdown()
            process.kill()
            return

    acc_info = mt5.account_info()
    print(json.dumps({
        "status": "connected",
        "message": "Authorized successfully",
        "balance": acc_info.balance if acc_info else 0,
        "currency": acc_info.currency if acc_info else "USD",
        "equity": acc_info.equity if acc_info else 0,
        "pid": process.pid
    }))

    mt5.shutdown()

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"status": "failed", "message": "Invalid arguments. Usage: exe login timeout password server"}))
        sys.exit(1)
        
    exe_path = sys.argv[1]
    acc_login = sys.argv[2]
    # NEW ARGUMENT ORDER: path, login, timeout, password, server
    wait_timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 60000
    acc_pass = sys.argv[4] if len(sys.argv) > 4 else ""
    acc_server = sys.argv[5] if len(sys.argv) > 5 else ""
    
    print(f"DEBUG: Launching terminal from {exe_path}")
    launch_and_verify(exe_path, acc_login, wait_timeout, acc_pass, acc_server)
