# VPS Deployment Guide for MT5 Backend

## System Overview
This is a production-ready Node.js (TypeScript) backend service that allows Telegram Mini App users to connect their MetaTrader 5 (MT5) trading accounts. The system automatically launches isolated MT5 terminal instances on a Windows VPS for each user.

### Architecture
- **API Server:** Node.js, Express, TypeScript
- **Database:** PostgreSQL (Stores user & account information securely)
- **Queue/Workers:** Redis + BullMQ (Prevents VPS overload by limiting concurrent MT5 launches)
- **Encryption:** AES-256-GCM (Passwords are NEVER stored in plaintext)
- **Process Orchestration:** Node `child_process.spawn` launches `terminal64.exe` natively on Windows.
- **Monitoring:** In-memory registry tracks active PIDs and restarts crashed terminals automatically.

## Prerequisites for the Windows VPS
1. **Windows OS:** Required for native MT5 execution.
2. **Node.js (v18+):** To run the backend.
3. **Docker Desktop for Windows:** Used *only* for PostgreSQL and Redis.
4. **Git:** To clone the repository.

## Step 1: MT5 Base Preparation
You **must** have a base, portable MT5 installation on the VPS before starting the code.
1. Copy a standard MetaTrader 5 installation directory (containing `terminal64.exe`).
2. Paste it to: `C:\mt5_base`
3. Create an empty directory for user instances: `C:\mt5_instances`

## Step 2: Code Installation
1. Clone the repository: 
   ```powershell
   git clone https://github.com/owenwebDe/Equivault_FX.git
   cd Equivault_FX
   ```
2. Install dependencies:
   ```powershell
   npm install
   ```

## Step 3: Environment Configuration
1. Copy the example environment file:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Generate a secure 256-bit encryption key:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Open `.env` and configure:
   - `MT5_SECRET_KEY` = (Paste the 64-character hex string generated above)
   - `TELEGRAM_BOT_TOKEN` = (Your Telegram Bot Token)
   - `DATABASE_URL` and `REDIS_URL` (Defaults should work if using the Docker Compose file)

## Step 4: Infrastructure Setup (Docker)
Start the PostgreSQL and Redis containers using Docker Compose:
```powershell
docker-compose up -d
```
*(Verify they are running using `docker ps`)*

## Step 5: Database Migration
Initialize the PostgreSQL tables:
```powershell
node scripts/migrate.js
```

## Step 6: Start the Backend
Start the server in development/testing mode:
```powershell
npm run dev
```

For production, you can build the TypeScript code and run the compiled JS with PM2 or as a Windows Service to keep it alive perpetually:
```powershell
npx tsc
node dist/server.js
```

## Step 7: Expose API securely (Cloudflare Tunnels)
To connect the Telegram bot without "unsafe" warnings (like ngrok gives), use Cloudflare Tunnels.
1. Download `cloudflared.exe` from the [official Cloudflare releases](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Run a Quick Tunnel for immediate testing:
   ```powershell
   cloudflared.exe tunnel --url http://localhost:8080
   ```
3. Copy the generated `.trycloudflare.com` URL.
4. Go to **@BotFather** on Telegram, use `/setmenubutton`, select your bot, and paste the Cloudflare URL. This makes the "Menu" button open your new Frontend!

---

## 🤖 Note to VPS AI Agent:
- Do **NOT** try to containerize or run MT5 inside Docker. The backend spawns `terminal64.exe` directly on the Windows host.
- The system automatically handles configuring `startup.ini` for each MT5 instance using `MaxBars=500` and strips heavy history/logs during copying.
- Ensure the VPS has enough RAM. Each MT5 instance takes roughly 150-200MB of RAM. The `MT5_MAX_CONCURRENT` setting in `.env` queue limits how many terminals can launch *simultaneously* to prevent CPU spikes.
