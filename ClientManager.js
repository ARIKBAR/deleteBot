// const { Client, LocalAuth,RemoteAuth  } = require('whatsapp-web.js');

// class ClientManager {
//     constructor() {
//         this.clients = new Map(); // userId -> {client, lastActive, status}
//         this.cleanupInterval = setInterval(() => this.cleanupInactiveClients(), 1800000); // 30 דקות
//     }

//     async initializeClient(userId) {
//         // אם כבר קיים client פעיל למשתמש זה
//         if (this.clients.has(userId)) {
//             const clientData = this.clients.get(userId);
//             if (clientData.status === 'active') {
//                 return clientData.client;
//             }
//             // אם ה-client קיים אבל לא פעיל, נסיר אותו
//             await this.removeClient(userId);
//         }

//         // יצירת client חדש
//         const client = new Client({
//             puppeteer: {
//                 args: [
//                     '--no-sandbox',
//                     '--disable-blink-features=AutomationControlled',
//                     '--disable-features=IsolateOrigins,site-per-process',
//                     '--disable-site-isolation-trials'
//                 ],
//                 headless: true,
//                 defaultViewport: null,
//                 ignoreDefaultArgs: ['--enable-automation']
//             },
//             authStrategy: new LocalAuth({
//                 clientId: userId,
//             }),
//             pairWithPhoneNumber: {
//                 showNotification: true,
//             }
//         });

//         // הגדרת מאזינים לאירועים
//         client.on('ready', () => {
//             console.log(`Client ${userId} is ready`);
//             this.updateClientStatus(userId, 'active');
//         });

//         client.on('disconnected', async () => {
//             console.log(`Client ${userId} disconnected`);
//             await this.removeClient(userId);
//         });

//         // שמירת ה-client החדש
//         this.clients.set(userId, {
//             client,
//             lastActive: Date.now(),
//             status: 'initializing'
//         });

//         return client;
//     }

//     async removeClient(userId) {
//         if (this.clients.has(userId)) {
//             const clientData = this.clients.get(userId);
//             try {
//                 await clientData.client.destroy();
//             } catch (error) {
//                 console.error(`Error destroying client ${userId}:`, error);
//             }
//             this.clients.delete(userId);
//         }
//     }

//     getClient(userId) {
//         return this.clients.get(userId)?.client;
//     }

//     updateClientStatus(userId, status) {
//         if (this.clients.has(userId)) {
//             const clientData = this.clients.get(userId);
//             clientData.status = status;
//             clientData.lastActive = Date.now();
//             this.clients.set(userId, clientData);
//         }
//     }

//     async cleanupInactiveClients() {
//         const now = Date.now();
//         const inactiveThreshold = 7200000; // 2 שעות

//         for (const [userId, clientData] of this.clients.entries()) {
//             if (now - clientData.lastActive > inactiveThreshold) {
//                 console.log(`Removing inactive client: ${userId}`);
//                 await this.removeClient(userId);
//             }
//         }
//     }
// }