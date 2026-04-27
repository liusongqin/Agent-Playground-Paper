# Agent Chat — Visual AI Assistant Frontend

A modern, feature-rich chat interface for interacting with AI models via the OpenAI-compatible API. Built with React + Vite, supports any OpenAI-compatible endpoint (OpenAI, Qwen, DeepSeek, Azure, local models, etc.).

![Agent Chat Screenshot](https://github.com/user-attachments/assets/873850c4-b3af-4a3c-9780-89c002bcfd5c)

## Features

- 💬 **Multi-conversation management** — Create, rename, delete, and switch between conversations
- 🔄 **Streaming responses** — Real-time token-by-token output with stop generation support
- 📝 **Markdown rendering** — Full GitHub Flavored Markdown with syntax highlighting for code blocks
- ⚙️ **Configurable settings** — API base URL, API key, model selection, temperature, max tokens, system prompt
- 🌐 **OpenAI-compatible** — Works with OpenAI, Qwen, DeepSeek, Azure OpenAI, and any compatible API
- 💾 **Persistent storage** — Conversations and settings saved to localStorage
- 📱 **Responsive design** — Works on desktop and mobile devices
- 🎨 **Clean modern UI** — Professional chat interface with sidebar navigation
- ⬛ **Integrated terminal** — Real system terminal via WebSocket (requires backend server)
- 📱 **ADB Assistant** — Android device control with screenshot, click, swipe, key events, and AI-powered element detection

## Quick Start

### 1. Start the backend server

The backend server provides a real system terminal (WebSocket) and ADB bridge (HTTP) for Android device control.

```bash
cd server
pip install -r requirements.txt
python server.py
```

This starts two services:
- **Terminal WebSocket server** on `ws://localhost:8765` — provides a real shell session
- **ADB bridge HTTP server** on `http://localhost:8080` — translates REST calls into `adb` commands

You can customize ports via environment variables:

```bash
TERMINAL_PORT=8765 ADB_PORT=8080 python server.py
```

By default the server binds to `127.0.0.1` (localhost only). To allow access from other machines on the network:

```bash
BIND_HOST=0.0.0.0 python server.py
```

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

### 3. ADB device setup (optional)

To use the ADB Assistant for Android device control:

```bash
# Connect to your Android device via ADB
adb connect <device-ip>:<port>
# Example: adb connect 192.168.3.147:5555

# Verify connection
adb devices
```

> **Note:** The ADB bridge URL in the web UI (default `http://localhost:8080`) is the address of the **bridge server**, not the Android device. The bridge server translates HTTP requests into ADB commands and communicates with the device.

## Configuration

Click the **⚙️ Settings** button to configure:

| Setting | Description | Default |
|---------|-------------|---------|
| API Base URL | OpenAI-compatible API endpoint | `https://api.openai.com/v1` |
| API Key | Your API key | — |
| Model | Model name to use | `gpt-3.5-turbo` |
| System Prompt | System instruction for the AI | `You are a helpful AI assistant.` |
| Temperature | Response randomness (0–2) | `0.7` |
| Max Tokens | Maximum response length | `2048` |
| Streaming | Enable/disable streaming | `true` |

### Example API Endpoints

| Provider | Base URL |
|----------|----------|
| OpenAI | `https://api.openai.com/v1` |
| Qwen (Alibaba) | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Azure OpenAI | `https://{resource}.openai.azure.com/openai/deployments/{model}/v1` |
| Local (Ollama) | `http://localhost:11434/v1` |

## Build for Production

```bash
cd frontend
npm run build
```

The output will be in `frontend/dist/` and can be served by any static file server.

## Tech Stack

- **React 19** — UI framework
- **Vite 7** — Build tool and dev server
- **Marked** — Markdown parsing
- **Highlight.js** — Code syntax highlighting
- **DOMPurify** — HTML sanitization for security
- **Python 3 / aiohttp / websockets** — Backend server (terminal + ADB bridge)
- **xterm.js** — Terminal emulator in the browser