const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.get('/qr', async (req, res) => {
    let responseHasBeenSent = false;

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
                    '--no-zygote',
                    '--disable-gpu'
                ],
                timeout: 120000  // 2 דקות
            }
        });

        client.on('qr', async (qr) => {
            console.log('QR Code generated');
            if (!responseHasBeenSent) {
                const qrCode = await qrcode.toDataURL(qr);
                res.json({ qrCode });
                responseHasBeenSent = true;
            }
        });

        client.on('loading_screen', (percent, message) => {
            console.log('LOADING SCREEN', percent, message);
        });

        client.on('authenticated', () => {
            console.log('AUTHENTICATED');
        });

        client.on('change_state', state => {
            console.log('CHANGE STATE', state);
        });

        client.on('disconnected', (reason) => {
            console.log('Client was disconnected:', reason);
        });

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
                            // נוסיף השהייה קטנה בין כל ניקוי
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            console.log(`Successfully cleared group: ${chat.name}`);
                            clearedCount++;
                        } catch (err) {
                            console.error(`Error clearing group ${chat.name}:`, err);
                        }
                    }
                    
                    await msg.reply(`Successfully cleared ${clearedCount} groups`);
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
        if (!responseHasBeenSent) {
            res.status(500).json({ error: error.message });
            responseHasBeenSent = true;
        }
    }
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});