# VerifiedVote

VerifiedVote is a secure, remote postal voting application designed to provide citizens who are unable to vote in person (due to medical reasons, military service, living abroad, or remote work) a secure and verified way to cast their ballots from anywhere. 

The application utilizes a multi-tier architecture involving cryptographic receipt generation, document review queues, and AI-powered facial verification to ensure the integrity of the voting process.

---

## 🚀 Key Features

### For Voters
- **Remote Ballot Requests:** Eligible voters can request a remote ballot by submitting their Voter ID, a live photo, and supporting documents proving their eligibility.
- **AI-Powered Identity Verification:** When the voting window opens, voters are verified using a live selfie which is matched against their baseline photo utilizing state-of-the-art AI facial recognition (DeepFace) to prevent impersonation.
- **Secure Voting:** Votes are cast securely with encrypted payloads. Voters receive a cryptographic **Receipt Token** upon voting, which they can use to independently verify their vote was recorded without exposing their actual ballot choice.
- **Responsive & Accessible UI:** The portal is fully responsive across all devices and adheres to modern web accessibility standards (ARIA attributes, keyboard navigation, high contrast modes).

### For Election Administrators
- **Document Review Queue:** Admins can securely review incoming postal ballot requests, verifying uploaded documents and face similarity scores before approving or rejecting applications.
- **Election Management:** Super Admins can create elections, manage candidates and parties, activate elections for requests, and transition elections to the live voting phase.
- **Audit Logs:** A secure, append-only cryptographic audit log tracks all administrative actions and system events.
- **Result Publishing:** Once an election concludes, admins can securely publish the cryptographically signed tally.

---

## 🏗️ Architecture

VerifiedVote uses a three-tier architecture:

1. **Frontend (React + Vite + TailwindCSS):** 
   A modern, accessible frontend providing tailored workflows for voters and administrators.
2. **Backend (Node.js + Express + PostgreSQL):** 
   The core API handling authentication, request queues, state machines, voting logic, and integration with external services. Database interactions are managed via Drizzle ORM.
3. **AI Service (Python + FastAPI):** 
   A dedicated microservice handling CPU/GPU-intensive facial verification and liveness detection.
4. **Storage (MinIO):** 
   S3-compatible object storage for securely handling Personally Identifiable Information (PII) like voter IDs and selfies.
5. **Security Services:** 
   Integrates Cloudflare Turnstile for bot protection and TextBee for SMS OTP notifications.

---

## 🔄 The Voting Flow

1. **Election Creation:** Admins create an election for a specific state and constituency.
2. **Authorization Request:** A voter accesses the portal, enters their Voter ID, completes an OTP verification, and submits a request with supporting documents (e.g., medical certificate) and a baseline photo.
3. **Admin Review:** Election officials review the request queue. They verify the documents and approve the request.
4. **Voting Phase:** Admins activate the voting phase. Approved voters receive an SMS with a secure, one-time voting link.
5. **Identity Verification:** The voter opens the link, completes an OTP check, and takes a live selfie. The **AI Service** compares this live selfie with the baseline photo provided during the request phase.
6. **Casting the Ballot:** If the AI verifies the identity, the voter is presented with the ballot, casts their vote, and receives a cryptographic receipt.

---

## 🛠️ Local Setup Guidelines

### 1. Prerequisites
- Node.js 20+
- PostgreSQL (or Neon URL)
- Docker Desktop (for MinIO storage)
- Python 3.10+ (for the AI Service)

### 2. Environment Variables
Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```
Fill in the necessary values (Database URLs, Admin credentials, Turnstile keys).

### 3. Database & Backend Setup
Install Node dependencies, run database migrations, and seed the initial admin accounts:
```bash
npm install
npm run migrate
npm run seed:admins
```

### 4. MinIO Setup (Document & Photo Storage)
MinIO is required to store uploaded voter IDs and documents. Start it using Docker:
```bash
docker compose up -d minio
```
*(MinIO Console is available at http://localhost:9001 with default credentials `minioadmin` / `minioadmin`)*

### 5. AI Service Setup (Facial Verification)
The Python service runs independently to process images during the live voting phase.
```bash
cd ai-service
python -m venv .venv

# Activate virtual environment
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```
*Note: The first start may take a few minutes as it downloads the DeepFace models.*

### 6. Start the Application
Return to the root directory and start the development server:
```bash
npm run dev
```
The application will be available at **http://localhost:3000**.

### 7. Testing Credentials
You can test the voter flow using the built-in mock voters:
- **Voter 1:** `ABC1234567` (Constituency: NEW DELHI, State: DELHI)
- **Voter 2:** `XYZ9876543` (Constituency: BANGALORE SOUTH, State: KARNATAKA)
- **OTP:** Use `123456` for local development.

Admin credentials are set via the `SUPER_ADMIN_USERNAME` and `SUPER_ADMIN_PASSWORD` values in your `.env` file.
