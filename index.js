const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const auth = require('./middleware/auth');

require('dotenv').config();
const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
const events = require('events');
const connectDB = require('./config/db');
const puppeteer = require('puppeteer');
const User = require('./models/User');
const fs = require('fs');
const path = require('path');


const app = express();
app.use(cors());

app.use(express.json());
app.use(express.static('public'));
app.use(cookieParser());
app.use('/api/auth', authRoutes);

console.log('Starting script...');
let hasStartedAutomation = false;

async function randomDelay(min = 500, max = 2000) {
    const delay = Math.floor(Math.random() * (max - min) + min);
    await new Promise(resolve => setTimeout(resolve, delay));
}

let clientInstance = null;
let globalcode
let currentPhoneNumber = null;

const eventEmitter = new events.EventEmitter();

const scheduledMessages = new Map();

function scheduleMessage(groupId, message, timestamp) {
    const timeoutId = setTimeout(async () => {
        try {
            const chat = await clientInstance.getChatById(groupId);
            await chat.sendMessage(message);
            scheduledMessages.delete(`${groupId}-${timestamp}`);
        } catch (error) {
            console.error(`Error sending scheduled message to group ${groupId}:`, error);
        }
    }, timestamp - Date.now());

    scheduledMessages.set(`${groupId}-${timestamp}`, timeoutId);
}

app.post('/send-message', async (req, res) => {
    try {
        if (!clientInstance) {
            return res.status(400).json({ error: 'Client not initialized' });
        }

        const { groupIds, message, scheduleTime } = req.body;

        if (!Array.isArray(groupIds) || groupIds.length === 0) {
            return res.status(400).json({ error: 'No groups selected' });
        }

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        let sentCount = 0;
        let scheduledCount = 0;

        for (let groupId of groupIds) {
            try {
                const chat = await clientInstance.getChatById(groupId);

                if (scheduleTime) {
                    scheduleMessage(groupId, message, scheduleTime);
                    scheduledCount++;
                } else {
                    await chat.sendMessage(message);
                    sentCount++;
                }
            } catch (err) {
                console.error(`Error with group ${groupId}:`, err);
            }
        }

        let responseMessage = '';
        if (sentCount > 0) {
            responseMessage += `נשלחו ${sentCount} הודעות בהצלחה. `;
        }
        if (scheduledCount > 0) {
            responseMessage += `תוזמנו ${scheduledCount} הודעות לשליחה.`;
        }

        res.json({ message: responseMessage });
    } catch (error) {
        console.error('Error sending messages:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/cancel-scheduled-messages', (req, res) => {
    const { groupId, timestamp } = req.body;
    const key = `${groupId}-${timestamp}`;

    if (scheduledMessages.has(key)) {
        clearTimeout(scheduledMessages.get(key));
        scheduledMessages.delete(key);
        res.json({ message: 'Scheduled message cancelled successfully' });
    } else {
        res.status(404).json({ error: 'Scheduled message not found' });
    }
});

app.get('/', (req, res) => {
    res.redirect('/login.html');
});

app.get('/dashboard.html', auth, (req, res, next) => {
    next();
});

app.get(['/login.html', '/register.html'], (req, res, next) => {
    if (req.cookies.token) {
        return res.redirect('/dashboard.html');
    }
    next();
});

const createWhatsAppClient = (userId, phoneNumber) => {
    const sanitizedPhone = phoneNumber.replace(/[^0-9]/g, '');
    return new Client({
        puppeteer: {
            args: [
                '--no-sandbox',
                "--no-zygote",
                "--disable-setuid-sandbox",
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials'
            ],
            executablePath:
                process.env.NODE_ENV === "production"
                    ? process.env.PUPPETEER_EXECUTABLE_PATH
                    : puppeteer.executablePath(),
            headless: true,
            defaultViewport: null,
            ignoreDefaultArgs: ['--enable-automation'],
        },
        authStrategy: new LocalAuth({
            clientId: `session-${sanitizedPhone}`,
            dataPath: path.join(__dirname, 'data'),
        }),
        pairWithPhoneNumber: {
            phoneNumber: sanitizedPhone,
            showNotification: true,
        }
    });
};

const initializeWhatsAppClient = (client, user) => {
    client.on('authenticated', async (session) => {
        try {
            const sessionData = await client.pupPage.evaluate(() => {
                return localStorage.getItem('WAWebSessionData');
            });
            
            if (sessionData) {
                user.sessionData = sessionData;
                await user.save();
                console.log('Session saved to user account');
            }
        } catch (error) {
            console.error('Error saving session:', error);
        }
    });

    client.on('ready', () => {
        console.log('Client is ready!');
        clientInstance = client;
    });

    return client;
};

app.get('/connection-status', auth, async (req, res) => {
    try {
        const user = req.user;
        let hasSession = false;
        
        if (user.whatsappNumber) {
            hasSession = await checkExistingSession(user.whatsappNumber);
        }
        
        const isConnected = clientInstance && clientInstance.pupPage;
        
        res.json({
            isConnected,
            whatsappNumber: user.whatsappNumber,
            hasSession
        });
    } catch (error) {
        console.error('Error checking connection status:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/start-connection', auth, async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        const numberToUse = phoneNumber || req.user.whatsappNumber;
        
        if (!numberToUse) {
            return res.status(400).json({ error: 'Phone number is required' });
        }
        if (phoneNumber) {
            req.user.whatsappNumber = phoneNumber;
            await req.user.save();
        }
        currentPhoneNumber = numberToUse;
        const client = createWhatsAppClient(req.user._id.toString(), numberToUse);

        client.on('ready', () => {
            console.log('Client is ready!');
            clientInstance = client;
        });

        client.on('authenticated', async () => {
            try {
                const sessionData = await client.pupPage.evaluate(() => {
                    return localStorage.getItem('WAWebSessionData');
                });
                
                if (sessionData) {
                    req.user.sessionData = sessionData;
                    req.user.whatsappNumber = numberToUse;
                    await req.user.save();
                    console.log('Session saved for phone:', numberToUse);
                }
            } catch (error) {
                console.error('Error saving session:', error);
            }
        });

        await client.initialize();
        res.json({ success: true });
    } catch (error) {
        console.error('Error starting connection:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/check-session', auth, async (req, res) => {
    try {
        if (req.user.sessionData) {
            res.json({ hasSession: true });
        } else {
            res.json({ hasSession: false });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/qr', auth, async (req, res) => {
    const phoneNumber = req.user.whatsappNumber;
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    const sanitizedPhone = phoneNumber.replace(/[^0-9]/g, '');

    const client = new Client({
        puppeteer: {
            args: [
                '--no-sandbox',
                "--no-zygote",
                "--disable-setuid-sandbox",
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials'
            ],
            executablePath:
                process.env.NODE_ENV === "production"
                    ? process.env.PUPPETEER_EXECUTABLE_PATH
                    : puppeteer.executablePath(),
            headless: true,
            defaultViewport: null,
            ignoreDefaultArgs: ['--enable-automation'],
        },
        authStrategy: new LocalAuth({
            clientId: `session-${sanitizedPhone}`,
        }),
        pairWithPhoneNumber: {
            phoneNumber: sanitizedPhone,
            showNotification: true,
        }
    });

    let extractedCode = null;

    async function startAutomation() {
        try {
            if (hasStartedAutomation) {
                console.log('Automation already started, skipping...');
                return;
            }
    
            hasStartedAutomation = true;
            console.log('Starting automation process...');
    
            const page = await client.pupPage;
            if (!page) {
                throw new Error('Page not available');
            }
            console.log('Page obtained successfully');
    
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                window.navigator.chrome = { runtime: {} };
                Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he'] });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            });
            console.log('Browser behaviors set');
    
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            console.log('User agent set');
    
            console.log('Looking for phone button...');
            await page.waitForSelector('[data-icon="chevron"]', { 
                timeout: 60000,
            });
            console.log('Phone button found');
            
            await randomDelay(1000, 2000);
            await page.click('[data-icon="chevron"]');
            console.log('Phone button clicked successfully');
    
            console.log('Looking for phone input...');
            const phoneInputSelector = '.selectable-text.x1n2onr6.xy9n6vp.x1n327nk.xh8yej3.x972fbf.xcfux6l.x1qhh985.xm0m39n.xjbqb8w.x1uvtmcs.x1jchvi3.xss6m8b.xexx8yu.x4uap5.x18d9i69.xkhd6sd';
            await page.waitForSelector(phoneInputSelector, { 
                timeout: 60000,
            });
            console.log('Phone input found');
    
            await randomDelay(1000, 2000);
            await page.type(phoneInputSelector, currentPhoneNumber, { delay: 100 });
            console.log('Phone number entered successfully');
    
            console.log('Looking for next button...');
            const nextButtonSelector = '.x889kno.x1a8lsjc.xbbxn1n.xxbr6pl.x1n2onr6.x1rg5ohu.xk50ysn.x1f6kntn.xyesn5m.x1z11no5.xjy5m1g.x1mnwbp6.x4pb5v6.x178xt8z.xm81vs4.xso031l.xy80clv.x13fuv20.xu3j5b3.x1q0q8m5.x26u7qi.x1v8p93f.xogb00i.x16stqrj.x1ftr3km.x1hl8ikr.xfagghw.x9dyr19.x9lcvmn.xbtce8p.x14v0smp.xo8ufso.xcjl5na.x1k3x3db.xuxw1ft.xv52azi';
            await page.waitForSelector(nextButtonSelector, { 
                timeout: 60000,
            });
            console.log('Next button found');
    
            await randomDelay(1000, 2000);
            await page.click(nextButtonSelector);
            console.log('Next button clicked successfully');
    
            console.log('Waiting for code to appear...');
            await page.waitForSelector('div[data-link-code]', { 
                timeout: 60000,
            });
            console.log('Code element found');
    
            console.log('Extracting code...');
            const code = await page.evaluate(() => {
                const codeElement = document.querySelector('div[data-link-code]');
                if (codeElement) {
                    const codeAttr = codeElement.getAttribute('data-link-code');
                    return codeAttr.split(',').join('');
                }
                return null;
            });
    
            if (code) {
                console.log('Code extracted successfully:', code);
                extractedCode = code;
                return code;
            } else {
                throw new Error('Could not extract pairing code');
            }
    
        } catch (error) {
            console.error('Error in automation process:', error);
            console.error('Error stack:', error.stack);
            hasStartedAutomation = false;
            throw error;
        }
    }
    app.get('/code', (req, res) => {
        if (extractedCode) {
            res.json({ code: extractedCode });
        } else {
            res.status(404).json({ error: 'Code not yet available' });
        }
    });

    client.on('qr', async () => {
        console.log('QR Code received, starting automation...');
        if (!hasStartedAutomation) {
            setTimeout(async () => {
                await startAutomation().catch(console.error);
            }, 800);
        }
    });

    client.on('remote_session_saved', async () => {
        if (clientInstance && req.user) {
            try {
                const sessionData = await clientInstance.pupPage.evaluate(() => {
                    return localStorage.getItem('WAWebSessionData');
                });
                
                if (sessionData) {
                    req.user.sessionData = sessionData;
                    await req.user.save();
                    console.log('Session saved to user account');
                }
            } catch (error) {
                console.error('Error saving session:', error);
            }
        }
    });

    client.on('message_create', async (message) => {
        if (message.body === '!cleargroups' && message.fromMe) {
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

                await message.reply(`נמחקו בהצלחה  ${clearedCount} קבוצות. פרטי הקבוצות:\n` +
                    groupChats.map(chat => `${chat.name}`).join('\n \n'));
                console.log('Finished clearing groups');
            } catch (error) {
                console.error('Error clearing groups:', error);
                await message.reply('Error occurred while clearing groups');
            }
        }
    });

    client.on('ready', async () => {
        console.log('Client is ready!');
        clientInstance = client;

        try {
            console.log('Start loading groups...');
            const startTime = Date.now();

            const groups = await client.getGroupsFromStore();

            const durationInSeconds = (Date.now() - startTime) / 1000;
            console.log(`Groups loaded (${groups.length}) in ${durationInSeconds} seconds`);

            app.locals.groupChats = groups;
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

    client.on('message_create', message => {
        if (message.body === 'שליחת צילום מסך מפייבוקס') {
            // reply back "pong" directly to the message
            setTimeout(() => {
                message.reply('אנא שלח פה צילום מסך של ההעברה על מנת שנוכל לאשר את הצטרפותך לבוט');
            }
                , 1500);
        }
    });

    client.on('message_create', message => {
        if (message.body === 'הוספה כנהג') {
            // reply back "pong" directly to the message
            setTimeout(() => {
                message.reply(`היי,
לא מצאנו את הפרטים שלך במאגר הנהגים שלנו
כדי שנוכל לצרף אותך אנא שלח לנו את הפרטים הבאים:
        *שם מלא:*
        *סוג רכב:*
        *שנתון רכב:*
        *מספר הווטסאפ שלך:*
                    
לאחר קבלת הפרטים נטפל בבקשתך בהקדם האפשרי.
    בברכה,
    קאש דרייבר`);
        }
            , 1000);
        }
    });

    client.on('message_create', message => {
        if (message.body === 'מעוניין להצטרף לבוט') {
            // reply back "pong" directly to the message
            setTimeout(() => {
                message.reply(`שמנו לב שהתחלת בתהליך ההתחברות לבוט שלנו

אם ברצונך להשתמש באגרון נהגים (חינמי לכולם) שלח את ההודעה הבאה:

> https://api.whatsapp.com/send?phone=972538651172&text=דירוג

אם ברצונך להצטרף לאחד מהמסלולים בתשלום, 
עקוב אחר ההוראות
> הליך הצטרפות

• בחירת מסלול : בחר את המסלול המתאים לך מתוך האפשרויות המפורטות.

• תשלום באמצעות PayBox: בצע את התשלום באמצעות אפליקציית PayBox למספר המצורף בפירוט החבילות.

• תשלום בהעברה בנקאית: בצע העברה בנקאית לחשבון המצורף באפשרויות תשלום.

• אישור התשלום : שלח צילום מסך המאשר את ביצוע התשלום למספר: 050-9926121.

לאחר השלמת שלבים אלו, תצורף בהצלחה למסלול הנבחר.

> פירוט חבילות

*_______________*
מסלול BASIC
✔️ הכנסות הוצאות וסיכום
✔️ הגדרות וסטטוס יעד
✔️ רישום וניהול תותים (בפיתוח)
✔️ חיפוש מידע על נהג
הפקת דוח אקסל
חישוב רווח לשעת עבודה
פייבוקס:0525868551
💵 מסלול בייסיק - 40₪
*_______________*
מסלול PREMIUM:
✔️ הכנסות הוצאות וסיכום
✔️ הגדרות וסטטוס יעד
✔️ רישום וניהול תותים (בפיתוח)
✔️ הפקת דוח אקסל
✔️ חישוב רווח לשעת עבודה
✔️ חיפוש מידע על נהג
➕ גישה מוקדמת לפיצ'רים חדשים
פייבוקס:0525868551
💵 מסלול פרימיום - 60₪
*_______________*

`);
        }
            , 3500);
        }
    });

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
        const groups = await clientInstance.getGroupsFromStore();
        console.log(`Sending ${groups.length} groups to client`);
        res.json(groups);
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/clear-groups', async (req, res) => {
    try {
        if (!clientInstance || !clientInstance.info) {
            console.error('Client instance is not initialized or not ready');
            return res.status(400).json({ error: 'Client not initialized' });
        }

        const { groupIds } = req.body;

        console.log("Received Group IDs for Clearing:", groupIds);

        if (!Array.isArray(groupIds) || groupIds.length === 0 || groupIds.includes('undefined')) {
            return res.status(400).json({ error: 'No valid groups selected' });
        }

        let clearedCount = 0;
        for (let groupId of groupIds) {
            if (!groupId.endsWith('@g.us')) {
                console.warn(`Skipping invalid group ID: ${groupId}`);
                continue; 
            }

            try {
                const chat = await clientInstance.getChatById(groupId);
                if (!chat) {
                    console.warn(`Chat not found for ID: ${groupId}`);
                    continue;
                }

                console.log(`Clearing messages for group: ${chat.name} (${groupId})`);
                await chat.clearMessages();
                clearedCount++;
            } catch (err) {
                console.error(`Error clearing group ${groupId}:`, err);
            }
        }

        console.log(`Successfully cleared ${clearedCount} groups`);
        res.json({ message: `Successfully cleared ${clearedCount} groups` });
    } catch (error) {
        console.error('Error in /clear-groups:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/restore-session', auth, async (req, res) => {
    try {
        if (req.user.sessionData) {
            await clientInstance.pupPage.evaluate((sessionData) => {
                localStorage.setItem('WAWebSessionData', sessionData);
            }, req.user.sessionData);
            
            await clientInstance.initialize();
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'No saved session found' });
        }
    } catch (error) {
        console.error('Error restoring session:', error);
        res.status(500).json({ error: error.message });
    }
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const port = process.env.PORT || 2000;

const startServer = async () => {
    try {
        await connectDB();
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

const checkExistingSession = async (phoneNumber) => {
    const sanitizedPhone = phoneNumber.replace(/[^0-9]/g, '');
    const sessionPath = `./sessions/session-${sanitizedPhone}`;
    
    try {
        await fs.access(sessionPath);
        return true;
    } catch {
        return false;
    }
};

process.on('SIGINT', async () => {
    if (clientInstance) {
        await clientInstance.destroy();
    }
    process.exit();
});
