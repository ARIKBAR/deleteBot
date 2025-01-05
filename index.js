const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());
app.use(express.static('public'));

// יצירת browser instance גלובלי
let globalBrowser = null;

async function initBrowser() {
    if (globalBrowser) return globalBrowser;
    
    globalBrowser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-accelerated-2d-canvas',
            '--disable-gl',
            '--disable-2d-canvas-clip-aa',
            '--disable-2d-canvas-image-chromium',
            '--single-process',
            '--no-first-run',
            '--no-zygote',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--disable-web-security'
        ],
        ...(process.env.NODE_ENV === 'production' ? { 
            executablePath: '/usr/bin/google-chrome-stable' 
        } : {})
    });

    return globalBrowser;
}

app.get('/qr', async (req, res) => {
    try {
        // יצירת browser instance
        const browser = await initBrowser();

        const clientConfig = {
            authStrategy: new LocalAuth({ clientId: Date.now().toString() }),
            puppeteer: {
                headless: true,
                browser: browser
            }
        };

        const client = new Client(clientConfig);

        client.on('qr', async (qr) => {
            try {
                console.log('QR Code generated');
                const qrCode = await qrcode.toDataURL(qr);
                global.lastQR = qrCode;
                res.json({ qrCode });
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

                console.log('Cleanup finished');
                await client.destroy();

            } catch (error) {
                console.error('Error in cleanup process:', error);
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

        client.on('disconnected', async (reason) => {
            console.log('Client was disconnected:', reason);
            await client.destroy();
        });

        await client.initialize();

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
});

// הוספת נקודת סיום לסגירת הדפדפן
process.on('SIGINT', async () => {
    if (globalBrowser) {
        await globalBrowser.close();
        process.exit();
    }
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});