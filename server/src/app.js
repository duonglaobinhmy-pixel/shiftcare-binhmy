import 'dotenv/config';
import express from 'express';import cors from 'cors';import morgan from 'morgan';import path from 'path';import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.routes.js';import bcareRoutes from './routes/bcare.routes.js';import usersRoutes from './routes/users.routes.js';import coreRoutes from './routes/core.routes.js';import aiRoutes from './routes/ai.routes.js';
import medicationRoutes from './routes/medication.routes.js';
import { startMediaRetentionCleanup } from './services/media-retention.service.js';
const app=express();app.use(cors());app.use(express.json({limit:'12mb'}));app.use(morgan('dev'));
startMediaRetentionCleanup();
app.get('/api/health',(_req,res)=>res.json({ok:true,service:'shiftcare-bcare-demo-rbac-pwa-ai',database:{mode:'JSON_FILE_DEMO',ok:true},pwa:true,ai:process.env.GEMINI_API_KEY?'GEMINI':'LOCAL_DEMO',telegramAlerts:!!(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_ALERT_CHAT_ID),time:new Date().toISOString()}));
app.use('/api/auth',authRoutes);app.use('/api/bcare',bcareRoutes);app.use('/api/users',usersRoutes);app.use('/api/ai',aiRoutes);app.use('/api/medication',medicationRoutes);app.use('/api',coreRoutes);
if(process.env.NODE_ENV==='production'){const __dirname=path.dirname(fileURLToPath(import.meta.url));const dist=path.resolve(__dirname,'../../client/dist');app.use(express.static(dist,{maxAge:'1h'}));app.get('*',(req,res,next)=>{if(req.path.startsWith('/api/'))return next();res.sendFile(path.join(dist,'index.html'))})}
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({success:false,message:err?.message||'Lỗi hệ thống'})});
const port=Number(process.env.PORT||8788);app.listen(port,()=>console.log(`ShiftCare API listening on :${port}`));
