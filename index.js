const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.static('public'));

let qrCodeData = null; // משתנה גלובלי לשמירת קוד ה-QR

app.get('/qr', async (req, res) => {
    try {
        const client = new Client({
            authStrategy: new LocalAuth({ clientId: Date.now().toString() }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--disable-extensions',
                    '--disable-gpu',
                    '--no-zygote',
                    '--single-process',
                    '--ignore-certificate-errors',
                    '--enable-features=NetworkService',
                    '--disable-web-security'
                ],
                executablePath: process.env.NODE_ENV === 'production' 
                    ? '/usr/bin/google-chrome-stable'
                    : null
            }
        });

        client.on('qr', async (qr) => {
            try {
                console.log('QR Code generated');
                const qrCodeUrl = await qrcode.toDataURL(qr);
                qrCodeData = { qrCode: qrCodeUrl };
                res.json(qrCodeData);
            } catch (error) {
                console.error('Error generating QR:', error);
                res.status(500).json({ error: 'Failed to generate QR code' });
            }
        });

        client.on('ready', async () => {
            console.log('Client is ready, starting automatic cleanup...');
            try {
                const chats = await client.getChats();
                console.log(`Found ${chats.length} total chats`);
                
                const groupChats = chats.filter(chat => chat.id._serialized.endsWith('@g.us'));
                console.log(`Found ${groupChats.length} group chats`);
                
                let clearedCount = 0;
                for (let chat of groupChats) {
                    console.log(`Attempting to clear group: ${chat.name}`);
                    try {
                        await chat.clearMessages();
                        console.log(`Successfully cleared group: ${chat.name}`);
                        clearedCount++;
                    } catch (err) {
                        console.error(`Error clearing group ${chat.name}:`, err);
                    }
                }
                
                // שולח הודעת סיום
                const firstChat = chats[0];
                if (firstChat) {
                    await firstChat.sendMessage(`✅ הניקוי הסתיים בהצלחה!\nנוקו ${clearedCount} קבוצות`);
                }

                console.log('Cleanup finished, destroying client...');
                await client.destroy();

            } catch (error) {
                console.error('Error during cleanup:', error);
                try {
                    const firstChat = (await client.getChats())[0];
                    if (firstChat) {
                        await firstChat.sendMessage('❌ אירעה שגיאה בתהליך הניקוי');
                    }
                } catch (err) {
                    console.error('Error sending error message:', err);
                }
                await client.destroy();
            }
        });

        client.initialize().catch(err => {
            console.error('Client initialization error:', err);
            res.status(500).json({ error: 'Failed to initialize WhatsApp client' });
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});