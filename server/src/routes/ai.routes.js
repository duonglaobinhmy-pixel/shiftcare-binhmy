import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { answerAI, cleanTranscriptAI, transcribeAudioAI } from '../services/ai.service.js';
import { audit } from '../services/audit.service.js';

const router=Router();
router.use(authenticate);

function normalizeMessage(value){
  if(typeof value==='string')return value.trim();
  if(value&&typeof value==='object'&&typeof value.message==='string')return value.message.trim();
  return '';
}

router.post('/chat',async(req,res,next)=>{
  try{
    const message=normalizeMessage(req.body?.message);
    if(!message)return res.status(400).json({success:false,message:'Thiếu câu hỏi'});
    if(message.length>1200)return res.status(400).json({success:false,message:'Câu hỏi quá dài'});
    const data=await answerAI(req.user,message);
    await audit(req.user,'AI_CHAT','ai_chat',null,{mode:data.mode,questionLength:message.length});
    res.json({success:true,data});
  }catch(error){next(error)}
});

router.post('/clean-transcript',async(req,res,next)=>{
  try{
    const text=String(req.body?.text||'').trim();
    if(!text)return res.status(400).json({success:false,message:'Thiếu nội dung giọng nói'});
    if(text.length>2000)return res.status(400).json({success:false,message:'Nội dung giọng nói quá dài'});
    const data=await cleanTranscriptAI(text);
    await audit(req.user,'AI_TRANSCRIPT_CLEAN','ai_transcript',null,{mode:data.mode,textLength:text.length});
    res.json({success:true,data});
  }catch(error){next(error)}
});

router.post('/transcribe-audio',async(req,res,next)=>{
  try{
    const audioBase64=String(req.body?.audioBase64||'');
    const mimeType=String(req.body?.mimeType||'audio/webm');
    if(!audioBase64)return res.status(400).json({success:false,message:'Thiếu dữ liệu âm thanh'});
    const data=await transcribeAudioAI(audioBase64,mimeType);
    await audit(req.user,'AI_AUDIO_TRANSCRIBE','ai_audio',null,{mode:data.mode,model:data.model,mimeType:data.mimeType,sizeBytes:data.sizeBytes});
    res.json({success:true,data});
  }catch(error){next(error)}
});

export default router;
