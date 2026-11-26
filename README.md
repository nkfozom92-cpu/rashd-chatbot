🤖 TALHA THE AI

Premium WhatsApp AI Assistant powered by Google Gemini

TALHA THE AI is a Node.js-based WhatsApp AI chatbot with a web dashboard, Gemini AI responses, WhatsApp pairing-code login, image generation, and automatic reconnection.

---

✨ Features

Feature| Description
🧠 Gemini AI| AI-powered question and answer
🌐 Multilingual| Bengali, English, Hindi and other languages
📱 WhatsApp Pairing| Connect WhatsApp using a pairing code
🎨 Image Generation| Generate images using "/image"
⌨️ Typing Indicator| Shows typing while preparing replies
🔄 Auto Reconnect| Attempts to reconnect after disconnection
🔐 Admin Login| Protects administrative API endpoints
📊 Web Dashboard| Monitor WhatsApp status and logs
🩺 Health Check| Public "/health" endpoint

---

🛠️ Technologies

- Node.js
- Express.js
- Google Gemini API
- WhatsApp Baileys
- Axios
- Pino
- Pollinations Image API

---

📦 Installation

1. Clone the repository

git clone https://github.com/nkfozom92-cpu/rashd-chatbot.git

2. Enter the project directory

cd rashd-chatbot

3. Install dependencies

npm install

4. Configure environment variables

Create a ".env" file in the project root.

PORT=3000
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-2.5-flash
ADMIN_TOKEN=YOUR_SECRET_ADMIN_TOKEN
AUTH_DIR=./auth_info

Replace the placeholder values with your own credentials.

Important: Never upload your real API key or Admin Token to GitHub.

5. Start the server

npm start

Open:

http://localhost:3000

---

🔑 Environment Variables

Variable| Required| Description
"PORT"| No| Server port; default is 3000
"GEMINI_API_KEY"| Yes| Google Gemini API key
"GEMINI_MODEL"| No| Gemini model; default is "gemini-2.5-flash"
"ADMIN_TOKEN"| Yes| Secret dashboard/API login token
"AUTH_DIR"| No| WhatsApp session storage directory

---

🔐 Admin Dashboard Login

1. Open the dashboard.
2. Enter your "ADMIN_TOKEN".
3. Press LOGIN.
4. After successful login, you can use WhatsApp pairing and session management.

The Admin Token is different from the Gemini API key.

---

📱 WhatsApp Pairing

1. Open the dashboard.
2. Complete Admin Login.
3. Enter your WhatsApp phone number with country code.
4. Do not include the "+" sign.

Example:

8801712345678

5. Press START WHATSAPP.
6. Wait for the pairing code.
7. Open WhatsApp.
8. Go to Settings → Linked Devices.
9. Select Link a Device.
10. Choose Link with phone number instead.
11. Enter the pairing code.

Your WhatsApp account should now connect.

---

🎨 Image Generation

Send an image request using:

/image a beautiful sunset over the ocean

Example in Bengali:

/image একটি সুন্দর সূর্যাস্তের ছবি

The bot will request an image from the Pollinations image service and send it to the WhatsApp chat.

Image generation depends on the availability of the external service.

---

🌐 API Endpoints

Endpoint| Method| Authentication
"/"| GET| Public dashboard
"/health"| GET| Public
"/api/status"| GET| Admin Token
"/api/logs"| GET| Admin Token
"/api/wa/start"| POST| Admin Token
"/api/wa/reset"| POST| Admin Token

Admin-protected requests use:

x-admin-token: YOUR_ADMIN_TOKEN

WhatsApp start request example:

{
  "phone": "8801712345678"
}

---

☁️ Render Deployment

1. Push your project to GitHub.
2. Open Render.
3. Create a new Web Service.
4. Connect this repository:

nkfozom92-cpu/rashd-chatbot

5. Select Node as the runtime.
6. Set the build command:

npm install --omit=dev

7. Set the start command:

node index.js

8. Add these Environment Variables in Render:

GEMINI_API_KEY
GEMINI_MODEL
ADMIN_TOKEN
AUTH_DIR

Use your own secret values.

WhatsApp Session Storage

The WhatsApp login session is stored in the directory specified by "AUTH_DIR".

For persistent sessions, configure storage that survives service restarts and deployments. If the hosting service uses temporary storage, the WhatsApp session may be lost.

Do not share your "auth_info" folder. It contains sensitive WhatsApp login credentials.

---

🩺 Health Check

Open:

https://YOUR-RENDER-URL/health

Example response:

{
  "status": "OK",
  "whatsapp": "offline",
  "uptime": 120
}

The WhatsApp status and uptime values change according to the running service.

---

⚠️ Troubleshooting

Gemini API Error

- Check "GEMINI_API_KEY".
- Verify that the selected Gemini model is available to your API key.
- Check your Google AI API quota and billing requirements.

Pairing Code Not Appearing

- Verify the phone number and country code.
- Check the Render logs.
- Refresh the dashboard after waiting a few seconds.

WhatsApp Disconnected

- Check the Render logs.
- Verify that the session directory is available.
- If necessary, use RESET SESSION and pair again.

Image Generation Failed

- The external image service may be temporarily unavailable.
- Try again later.

---

📁 Project Structure

rashd-chatbot/
├── index.js
├── package.json
├── package-lock.json
├── .env.example
├── render.yaml
├── Dockerfile
├── Procfile
└── assets/
    ├── logo.jpg
    └── banner.jpg

---

🔒 Security

- Keep API keys private.
- Never commit ".env" to GitHub.
- Use a strong and unique "ADMIN_TOKEN".
- Protect WhatsApp authentication files.
- Do not share your pairing code with anyone.

---

📄 License

This project is licensed under the ISC License.

---

👨‍💻 Developer

TALHA THE AI

GitHub: https://github.com/nkfozom92-cpu/rashd-chatbot

Built with ❤️ using Node.js, Gemini AI and WhatsApp Baileys.
