import express from "express";
import 'dotenv/config'; 
import { Telegraf, Markup } from 'telegraf';
import mongoose from 'mongoose';

const app=express();



// Ensure variables exist in system memory before initiating
if (!process.env.BOT_TOKEN || !process.env.MONGO_URI) {
  console.error('❌ CRITICAL ERROR: Environment variables are missing from your configuration configuration!');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🌿 Connected seamlessly to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// ==========================================
// 3. DATABASE SCHEMAS & MODELS
// ==========================================
const StudentProfileSchema = new mongoose.Schema({
  studentId: { type: Number, required: true, unique: true }, 
  realName: { type: String, required: true },
  schoolId: { type: String, required: true }
});
const StudentProfile = mongoose.model('StudentProfile', StudentProfileSchema);

const SessionSchema = new mongoose.Schema({
  classId: { type: String, required: true },
  studentId: { type: Number, required: true },
  fullName: { type: String, required: true },
  checksVerified: { type: Number, default: 0 },
  attendancePercentage: { type: Number, default: 0 }
});
SessionSchema.index({ classId: 1, studentId: 1 }, { unique: true });
const ClassSession = mongoose.model('ClassSession', SessionSchema);

// Global state to track live count sessions
let activeClasses = {}; 

// ==========================================
// 4. STUDENT REGISTRATION HANDLER
// ==========================================
bot.command('register', async (ctx) => {
  const text = ctx.message.text.split(' ');
  
  if (text.length < 3) {
    return ctx.reply('⚠️ **Registration Format Wrong!**\n\nPlease use underscores for spaces in your name.\nExample: `/register John_Doe SEC-2026-09`', { parse_mode: 'Markdown' });
  }

  const realName = text[1].replace(/_/g, ' '); 
  const schoolId = text[2];
  const studentId = ctx.from.id;

  try {
    await StudentProfile.findOneAndUpdate(
      { studentId },
      { realName, schoolId },
      { upsert: true, new: true }
    );
    ctx.reply(`✅ **Registration Complete!**\n\n👤 **Name:** ${realName}\n🆔 **ID Number:** ${schoolId}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(err);
    ctx.reply('❌ Registration error.');
  }
});

// ==========================================
// 5. LIVE PULSE TRACKING ENGINE
// ==========================================
bot.command('pulse_check', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const rawClassId = args[1] || 'default_class';
  const classId = rawClassId.replace(/[^a-zA-Z0-9]/g, ''); 
  const targetChatId = process.env.CHANNEL_ID || ctx.chat.id;

  if (!activeClasses[classId]) {
    activeClasses[classId] = { totalChecksCount: 1 };
  } else {
    activeClasses[classId].totalChecksCount += 1;
  }

  const currentCheckNum = activeClasses[classId].totalChecksCount;

  try {
    const sentMessage = await bot.telegram.sendMessage(
      targetChatId,
      `⏰ **Live Stream Attention Check #${currentCheckNum}!**\nClick the button within 15 minutes to prove you are watching!`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '📱 I am here watching!', callback_data: `verify:${classId}:${currentCheckNum}` }
          ]]
        }
      }
    );

    ctx.reply(`📢 Pulse check #${currentCheckNum} posted to channel!`);

    // Automatic clean-up removal delay loop
    const EXPIRY_TIME = 3 * 60 * 1000; // 1-minute tracking window test
    
    setTimeout(async () => {
      try {
        await bot.telegram.deleteMessage(targetChatId, sentMessage.message_id);
        console.log(`🗑️ Pulse Check automatically expired.`);
      } catch (err) {
        console.log('Post already removed manually.');
      }
    }, EXPIRY_TIME);

  } catch (err) {
    console.error(err);
    ctx.reply('❌ Failed to post check-in button.');
  }
});

// ==========================================
// 6. COMPLETELY FIXED INTERACTIVE CLICK MANAGER
// ==========================================
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;

  if (data && data.startsWith('verify:')) {
    const parts = data.split(':');
    const classId = parts[1]; 
    const checkNum = parts[2]; 
    
    const user = ctx.from;
    const fullName = `${user.first_name} ${user.last_name || ''}`.trim();

    try {
      let session = await ClassSession.findOne({ classId, studentId: user.id });

      if (!session) {
        session = new ClassSession({ classId, studentId: user.id, fullName });
      }

      session.checksVerified += 1;
      
      const totalPossible = activeClasses[classId]?.totalChecksCount || session.checksVerified || 1;
      session.attendancePercentage = Math.round((session.checksVerified / totalPossible) * 100);

      await session.save();
      
      // Open a native Telegram alert pop-up window instantly!
      await ctx.answerCbQuery(`✅ Verified!\nYour live stream presence score is ${session.attendancePercentage}%`, { show_alert: true });
      console.log(`🎯 Successfully logged attendance for student: ${fullName}`);

    } catch (err) {
      console.error('Click event error logs:', err);
      await ctx.answerCbQuery('❌ Processing error. Please click the button again.', { show_alert: true });
    }
  }
});


// ==========================================
// 7. ROSTER REPORT SPREADSHEET DISPATCHER
// ==========================================
bot.command('report', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const classId = args[1];

  if (!classId) {
    return ctx.reply('⚠️ Please provide the Class ID. Example: /report math101');
  }

  try {
    const records = await ClassSession.find({ classId }).sort({ attendancePercentage: -1 });

    if (records.length === 0) {
      return ctx.reply(`❌ No attendance data found for Class ID: "${classId}"`);
    }

    const csvHeader = 'No.,Official Name,Student ID,Telegram Handle,Total Taps,Presence Score\n';
    
    const csvRows = await Promise.all(records.map(async (student, index) => {
      const profile = await StudentProfile.findOne({ studentId: student.studentId });
      
      const officialName = profile ? profile.realName : student.fullName;
      const schoolId = profile ? profile.schoolId : 'NOT_REGISTERED';
      
      const safeName = officialName.replace(/"/g, '""');
      return `${index + 1},"${safeName}",${schoolId},@${student.fullName},${student.checksVerified},${student.attendancePercentage}%`;
    }));

    const csvContent = csvHeader + csvRows.join('\n');
    const fileBuffer = Buffer.from(csvContent, 'utf-8');
    const today = new Date().toISOString().split('T')[0];

    await ctx.replyWithDocument({
      source: fileBuffer,
      filename: `Official_Attendance_${classId}_${today}.csv`
    }, {
      caption: `📊 **Official Roster File Compiled!**\nClass ID: \`\${classId.toUpperCase()}\`\nTotal Students Captured: **${records.length}**`,
      parse_mode: 'Markdown'
    });

  } catch (err) {
    console.error(err);
    ctx.reply('❌ Error mapping database profiles.');
  }
});

bot.command('end_class', (ctx) => {
  const args = ctx.message.text.split(' ');
  const classId = args[1] || 'default_class';

  if (activeClasses[classId]) {
    delete activeClasses[classId]; 
    ctx.reply(`🏁 Attendance tracking closed for session: "${classId}". Fetch data with: /report ${classId}`);
  } else {
    ctx.reply('⚠️ No active session found with that ID.');
  }
});

// Launch polling listener engine
bot.launch().then(() => console.log('🤖 Telegram Attendance Bot running on ES Modules!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
const PORT = process.env.PORT || 10000
app.get("/",(ctx) => ctx.send("Bot status:ONLINE"))
app.listen(PORT,"0.0.0.0",() =>{
  console.log(`Mock web port listener successfully bound to port ${PORT}`)
})