import os

def find_server_names(file_path):
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return

    try:
        with open(file_path, 'rb') as f:
            data = f.read()
        
        # MT5 servers.dat stores names in UTF-16LE
        # We'll look for chunks that look like readable text
        decoded = data.decode('utf-16le', errors='ignore')
        
        print("Possible Server Names Found:")
        print("-" * 30)
        
        # Split by nulls or non-printable chars
        parts = []
        current = ""
        for char in decoded:
            if ord(char) >= 32 and ord(char) <= 126:
                current += char
            else:
                if len(current.strip()) > 3:
                    parts.append(current.strip())
                current = ""
        
        # Filter for "Crib" or obvious server names
        found = False
        for p in sorted(list(set(parts))):
            if "Crib" in p or "Server" in p or "Live" in p or "Demo" in p:
                print(f"FOUND: {p}")
                found = True
        
        if not found:
            print("No 'Crib' related names found in readable parts.")
            print("Direct dump of all strings > 3 chars:")
            for p in sorted(list(set(parts))):
                print(p)
                
    except Exception as e:
        print(f"Error reading file: {e}")

# Check both base and instance dirs
find_server_names(r'C:\mt5_base\Config\servers.dat')
print("\n--- Instance user_15 ---")
find_server_names(r'C:\MT5_Service\user_15\Config\servers.dat')
