const express = require('express');
const bodyParser = require('body-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// הגדרות השרת
const app = express();
const PORT = process.env.PORT || 3000;
const WHATSAPP_GROUP_ID = '120363419703663919@g.us'; // יש להחליף בזיהוי קבוצת וואטסאפ
const API_KEY = 'mSsTy,K6^ZU+x.jG{;nhQP'; // צור מפתח API מאובטח

// עיבוד בקשות JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// אימות API key
app.use('/mda-webhook', (req, res, next) => {
  const providedKey = req.headers['x-api-key'];
  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).send('Unauthorized');
  }
  next();
});

// יצירת לקוח WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox']
  }
});

// אירועים של WhatsApp
client.on('qr', (qr) => {
  // הצגת קוד QR לסריקה
  console.log('יש לסרוק את קוד ה-QR הבא עם וואטסאפ במכשיר הנייד:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('לקוח וואטסאפ מחובר ומוכן!');
});

client.on('authenticated', () => {
  console.log('אימות בוצע בהצלחה!');
});

client.on('auth_failure', (msg) => {
  console.error('שגיאת אימות:', msg);
});

// נקודת קצה לקבלת התראות מהאפליקציה
app.post('/mda-webhook', async (req, res) => {
  try {
    // בדיקה שהבקשה מכילה נתונים
    if (!req.body || !req.body.text) {
      return res.status(400).send('נתונים חסרים');
    }

    // חילוץ תוכן ההתראה
    const title = req.body.title || 'התראת מד"א';
    const text = req.body.text || 'אין פרטים נוספים';
    
    // עיבוד הטקסט (הסרת תווים בעייתיים, וכו')
    const cleanText = text.replace(/[^\w\s\u0590-\u05FF,.()-:]/g, '');
    
    // יצירת הודעה מעוצבת
    const message = `🚑 *התראת מד"א* 🚑\n\n*כותרת:* ${title}\n\n*פרטים:* ${cleanText}\n\n⏰ ${new Date().toLocaleString('he-IL')}`;
    
    // שליחת ההודעה לקבוצת וואטסאפ
    if (client.info) {
      await client.sendMessage(WHATSAPP_GROUP_ID, message);
      console.log('הודעה נשלחה בהצלחה לקבוצת וואטסאפ');
      return res.status(200).send('הודעה נשלחה בהצלחה');
    } else {
      console.error('לקוח וואטסאפ לא מחובר');
      return res.status(500).send('לקוח וואטסאפ לא מחובר');
    }
  } catch (error) {
    console.error('שגיאה בשליחת ההודעה:', error);
    return res.status(500).send(`שגיאה: ${error.message}`);
  }
});

// נקודת קצה לקבלת מזהי קבוצות וואטסאפ
app.get('/whatsapp-groups', async (req, res) => {
  try {
    if (!client.info) {
      return res.status(500).send('לקוח וואטסאפ לא מחובר');
    }
    
    const chats = await client.getChats();
    const groups = chats.filter(chat => chat.isGroup);
    
    const groupsInfo = groups.map(group => ({
      id: group.id._serialized,
      name: group.name
    }));
    
    return res.status(200).json(groupsInfo);
  } catch (error) {
    return res.status(500).send(`שגיאה: ${error.message}`);
  }
});

// נקודת קצה פשוטה לבדיקת תקינות השרת
app.get('/', (req, res) => {
  res.send('שרת MDA-WhatsApp פעיל');
});

// התחלת השרת
app.listen(PORT, () => {
  console.log(`השרת פעיל ומאזין בפורט ${PORT}`);
});

// התחברות ללקוח וואטסאפ
client.initialize();
