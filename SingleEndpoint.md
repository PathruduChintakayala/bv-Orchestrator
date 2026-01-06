Below are **two deliverables**, exactly as requested:

1. **GitHub Copilot prompt** (paste into Copilot Chat)
2. **Manual step-by-step instructions** to update the `hosts` file (Windows / macOS / Linux)

No extra commentary.

---

## 1️⃣ GitHub Copilot Prompt (paste verbatim)

> You are working on the **BV Orchestrator platform** (FastAPI backend, React UI, SDK, Runner).
>
> **Goal:** Enforce a **single Orchestrator base URL** in **local development**, identical to production behavior.
>
> ---
>
> ### Requirements
>
> 1. Standardize all components to accept **one URL only**:
>
>    * SDK (`bv auth login`)
>    * Runner (`python -m runner run`)
>    * UI (browser)
>    * Backend APIs
>
>    Use a single flag everywhere:
>
>    ```text
>    --server-url
>    ```
>
> 2. Assume Orchestrator is reachable at:
>
>    ```
>    http://orch.local
>    ```
>
> 3. Backend:
>
>    * APIs are served under `/api/*`
>    * No separate API base URL configuration exposed to users
>
> 4. Frontend:
>
>    * Use **relative API paths** (`/api/...`)
>    * Do not hardcode API hosts or ports
>
> 5. SDK:
>
>    * Remove `--api-url` and `--ui-url`
>    * Accept only `--server-url`
>    * Use it for:
>
>      * SDK auth API calls
>      * Browser-based login redirect
>
> 6. Runner:
>
>    * Use the same `--server-url`
>    * All runner API calls are relative to it
>
> ---
>
> ### Constraints
>
> * No backward compatibility required
> * Do not expose internal topology (UI vs API URLs)
> * Local dev behavior must match production behavior
>
> ---
>
> **Expected outcome**
>
> * `http://orch.local` works for:
>
>   * UI
>   * SDK auth
>   * Robot registration
>   * Job execution
> * Same CLI commands work unchanged in prod and local

---

## 2️⃣ Manual Steps: Update `hosts` File

### Purpose

Map a friendly local domain (`orch.local`) to your local machine (`127.0.0.1`).

---

## 🪟 Windows

### Steps

1. Open **Notepad as Administrator**

   * Start Menu → search **Notepad**
   * Right-click → **Run as administrator**

2. Open the hosts file:

   ```
   C:\Windows\System32\drivers\etc\hosts
   ```

3. Add this line at the end:

   ```
   127.0.0.1  orch.local
   ```

4. Save the file

5. (Optional) Flush DNS cache:

   ```powershell
   ipconfig /flushdns
   ```

---

## 🍎 macOS

### Steps

1. Open Terminal

2. Edit hosts file:

   ```bash
   sudo nano /etc/hosts
   ```

3. Add:

   ```
   127.0.0.1  orch.local
   ```

4. Save and exit:

   * `Ctrl + O` → Enter
   * `Ctrl + X`

5. Flush DNS cache:

   ```bash
   sudo dscacheutil -flushcache
   sudo killall -HUP mDNSResponder
   ```

---

## 🐧 Linux

### Steps

1. Open Terminal

2. Edit hosts file:

   ```bash
   sudo nano /etc/hosts
   ```

3. Add:

   ```
   127.0.0.1  orch.local
   ```

4. Save and exit:

   * `Ctrl + O` → Enter
   * `Ctrl + X`

5. (Optional) Restart network manager:

   ```bash
   sudo systemctl restart NetworkManager
   ```

---

## ✅ Verification (all OS)

Run:

```bash
ping orch.local
```

Expected:

```
Pinging orch.local [127.0.0.1]
```

Open browser:

```
http://orch.local
```

---

If you want next, I can provide:

* **NGINX config**
* **Caddy config (simpler)**
* **Docker Compose with reverse proxy**
* **Vite-only fallback setup**

Say which one.
