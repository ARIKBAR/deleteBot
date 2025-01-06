const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const events = require('events');

const app = express();
app.use(express.json());
app.use(express.static('public'));

let clientInstance;

const eventEmitter = new events.EventEmitter();

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
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });

        client.on('qr', async (qr) => {
            console.log('QR Code generated');
            const qrCode = await qrcode.toDataURL(qr);
            res.json({ qrCode });
        });

        client.on('message_create', async (msg) => {
            
            
            if (msg.body === '!cleargroups' && msg.fromMe) {
                console.log('Starting clear groups process...');
                try {
                    const chats = await client.getChats();
                    console.log(`Found ${chats.length} total chats`);
                    
                    const groupChats = chats.filter(chat => chat.id._serialized.endsWith('@g.us'));
                    console.log(`Found ${groupChats.length} group chats`);
                    
                    let clearedCount = 0;
                    for (let chat of groupChats) {
                        console.log(`Attempting to clear group: ${chat.name} (ID: ${chat.id._serialized})`);
                        try {
                            await chat.clearMessages();
                            console.log(`Successfully cleared group: ${chat.name} (ID: ${chat.id._serialized})`);
                            clearedCount++;
                        } catch (err) {
                            console.error(`Error clearing group ${chat.name} (ID: ${chat.id._serialized}):`, err);
                        }
                    }
                    
                    await msg.reply(`Successfully cleared ${clearedCount} groups. Group details:\n` +
                                    groupChats.map(chat => `${chat.name} (ID: ${chat.id._serialized})`).join('\n'));
                    console.log('Finished clearing groups');
                } catch (error) {
                    console.error('Error clearing groups:', error);
                    await msg.reply('Error occurred while clearing groups');
                }
            }
        });

        client.on('ready', async () => {
            console.log('Client is ready! Send !cleargroups to start clearing');
            clientInstance = client;

            // Fetch groups and notify the client
            try {
                const chats = await client.getChats();
                const groupChats = chats.filter(chat => chat.id._serialized.endsWith('@g.us'));
                console.log('Sending group list to client');
                app.locals.groupChats = groupChats.map(chat => ({ id: chat.id._serialized, name: chat.name }));
                eventEmitter.emit('client_ready');
            } catch (error) {
                console.error('Error fetching groups:', error);
            }
        });

        console.log('Initializing client...');
        client.on('loading_screen', (percent, message) => {
            console.log('LOADING SCREEN', percent, message);
        });
        
        client.on('authenticated', () => {
            console.log('AUTHENTICATED');
            eventEmitter.emit('authenticated');
        });
        
        client.on('auth_failure', msg => {
            console.error('AUTHENTICATION FAILURE', msg);
        });
        client.initialize();

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const clientReadyListener = () => {
        res.write('data: client_ready\n\n');
    };

    const authenticatedListener = () => {
        res.write('data: authenticated\n\n');
    };

    eventEmitter.on('client_ready', clientReadyListener);
    eventEmitter.on('authenticated', authenticatedListener);

    req.on('close', () => {
        eventEmitter.removeListener('client_ready', clientReadyListener);
        eventEmitter.removeListener('authenticated', authenticatedListener);
    });
});

app.get('/groups', async (req, res) => {
    try {
        if (!clientInstance) {
            return res.status(400).json({ error: 'Client not initialized' });
        }
        const chats = await clientInstance.getChats();
        const groupChats = chats.filter(chat => chat.id._serialized.endsWith('@g.us'));
        res.json(groupChats.map(chat => ({ id: chat.id._serialized, name: chat.name })));
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ error: error.message });
    }
});
    
app.post('/clear-groups', async (req, res) => {
    try {
        if (!clientInstance) {
            return res.status(400).json({ error: 'Client not initialized' });
        }
        const { groupIds } = req.body;
        if (!Array.isArray(groupIds) || groupIds.length === 0) {
            return res.status(400).json({ error: 'No groups selected' });
        }
        let clearedCount = 0;
        for (let groupId of groupIds) {
            const chat = await clientInstance.getChatById(groupId);
            if (chat) {
                try {
                    await chat.clearMessages();
                    clearedCount++;
                } catch (err) {
                    console.error(`Error clearing group ${chat.name} (ID: ${chat.id._serialized}):`, err);
                }
            }
        }
        res.json({ message: `Successfully cleared ${clearedCount} groups` });
    } catch (error) {
        console.error('Error clearing groups:', error);
        res.status(500).json({ error: error.message });
    }
});

const port = process.env.PORT || 2000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

