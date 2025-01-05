const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.static('public'));

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
            console.log('QR Code generated');
            const qrCode = await qrcode.toDataURL(qr);
            res.json({ qrCode });
        });

        // מאזין להודעות ומחכה לפקודה
        client.on('message_create', async (msg) => {
            console.log('Message created:', msg.body);
            
            if (msg.body === '!cleargroups' && msg.fromMe) {
                console.log('Starting clear groups process...');
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
                    
                    await msg.reply(`נמחקו בהצלחה  ${clearedCount} קבוצות`);
                    console.log('Finished clearing groups');
                } catch (error) {
                    console.error('Error clearing groups:', error);
                    await msg.reply('Error occurred while clearing groups');
                }
            }
        });

        client.on('ready', () => {
            console.log('Client is ready! Send !cleargroups to start clearing');
        });

        console.log('Initializing client...');
        client.initialize();

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
});

const port = 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});