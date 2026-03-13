# Privacy Policy (Last updated March 2026)

## The Core Principle

Vapor is built on the principle of **zero-persistence**. This means messages, files, and passwords are never saved to a hard drive or database. Everything exists only in the server's temporary memory (RAM) and is permanently wiped the moment a chat room ends or the server restarts.

## Disclaimer and Limitation of Liability

### "As-Is" Service
Vapor is provided as a free, experimental tool for private communication. Vapor is provided on an "as-is" and "as-available" basis. Vapor makes no guarantees, express or implied, regarding the reliability, availability, or security of the service beyond the privacy measures described in this policy.

### User Responsibility and Conduct
Because Vapor is a peer-to-peer (P2P) service, Vapor does not monitor, moderate, or have any visibility into the content shared between users. 
* Users are solely responsible for the messages, files, and data they exchange.
* Vapor cannot be held liable for any illegal, harmful, or offensive content shared by users.
* Users agree to use Vapor in compliance with all local and international laws.

### No Data Recovery
Because Vapor is built for zero-persistence, there is no way to recover chat history, or files. Once a room is closed or a server restarts, the data is gone forever. Vapor is not responsible for any loss of data.

### Limitation of Liability
To the maximum extent permitted by law, Vapor and its developer shall not be liable for any direct, indirect, incidental, or consequential damages resulting from the use or inability to use the service. This includes, but is not limited to, unauthorized access to your communications by third parties (such as through a compromised local device) or service interruptions.

### External Links and Risks
Users share links and files at their own risk. Vapor does not verify the safety of any content transferred between peers. We recommend using standard digital safety precautions when interacting with others.

## What Vapor Does Not Collect

* **No Personal Identity:** Vapor does not ask for names, email addresses, or accounts.
* **No Content Storage:** Chat messages and files travel directly between peers; they never stay on the Vapor server.
* **No Tracking:** Vapor uses no cookies, third-party analytics, or advertising scripts.
* **No Digital Footprint:** Vapor does not store information about a device beyond the current active session.

## What Is Temporarily Held in Server RAM

| Data | Why Vapor needs it | How long it stays |
| :--- | :--- | :--- |
| **Room Code** | To help the host and invited guests find the same private space. | Deleted when the room is closed. |
| **Security Key (Hashed)** | To verify that only people with the correct password can enter. | Deleted when the room is closed. |
| **Guest Identifiers** | To distinguish between different people in the chat without knowing who they are. | Deleted when the room is closed. |
| **Connection Tokens** | To allow a user to stay in the room if the internet flickers or the page is refreshed. | Deleted after 30–60 minutes of inactivity. |
| **Connection Signals** | To help devices "shake hands" and start talking directly to each other. | Deleted as soon as the connection is made. |
| **Join Counter** | To protect a room by blocking anyone trying to guess the password. | Deleted when the room is closed. |

## Password Handling

When a room password is created, Vapor immediately converts it into a complex security code. Vapor never sees or stores the actual plaintext password. Because this code lives only in temporary memory, if the server restarts, the code is lost—meaning a new room and password would be required.

## Security & Lockout Policy

To prevent unauthorized users from guessing a room password, Vapor uses a simple "strike" system:

| Attempt Range | Outcome |
| :--- | :--- |
| 1–3 Attempts | Access denied. The user can try again immediately. |
| 4–5 Attempts | Access denied. A 10-minute waiting period is required before trying again. |
| 6+ Attempts | Permanent lockout. Access to that specific room is blocked until the room is closed. |

## Chat and File Transfer

Once connected, messages and files are sent **directly from one device to another**. This is "Peer-to-Peer" communication. Because the data does not pass through Vapor's storage, Vapor has no way to read or see private conversations.

## Security & Encryption

* **To the Server:** The connection to Vapor is fully encrypted, ensuring room setup is private.
* **Between People:** Chat content is scrambled using industry-standard encryption, so only the people inside the room can read the messages.

## Server Logs

Vapor keeps basic technical logs to ensure the app is running smoothly (e.g., "A room was created" or "A connection failed"). These logs **never** contain messages, files, passwords, or any identifying information.

## Data Retention

Since Vapor doesn't save any data, there is no "history" to delete. Once a room is closed, all traces of that session are gone forever.