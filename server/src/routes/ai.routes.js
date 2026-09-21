import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  answerAI,
  cleanTranscriptAI,
  transcribeAudioAI,
  getAIStatus,
  generateDailyReport
} from '../services/ai.service.js';
import { audit } from '../services/audit.service.js';

const router = Router();
router.use(authenticate);

function normalizeMessage(value) {
  if (typeof value === 'string') return value.trim();
  if (
    value &&
    typeof value === 'object' &&
    typeof value.message === 'string'
  ) {
    return value.message.trim();
  }
  return '';
}

function normalizeScope(input = {}) {
  return {
    from: String(input.from || '').trim(),
    to: String(input.to || '').trim(),
    branchId: String(input.branchId || '').trim(),
    page: String(input.page || '').trim(),
    residentId: String(input.residentId || '').trim()
  };
}

/*
 * Audit không được phép làm hỏng chức năng chính.
 * Nếu bảng audit đang lỗi/migration chưa đồng bộ thì chỉ log warning.
 */
async function safeAudit(user, action, objectType, objectId, detail = {}) {
  try {
    await audit(user, action, objectType, objectId, detail);
  } catch (error) {
    console.error(
      `[AI AUDIT] ${action} failed:`,
      error?.message || error
    );
  }
}

router.get('/status', (_req, res) => {
  return res.json({
    success: true,
    data: getAIStatus()
  });
});

router.post('/chat', async (req, res) => {
  const message = normalizeMessage(req.body?.message);

  if (!message) {
    return res.status(400).json({
      success: false,
      message: 'Thiếu câu hỏi'
    });
  }

  if (message.length > 1200) {
    return res.status(400).json({
      success: false,
      message: 'Câu hỏi quá dài'
    });
  }

  const scope = normalizeScope(
    req.body?.scope || req.body || {}
  );

  try {
    const data = await answerAI(
      req.user,
      message,
      scope
    );

    await safeAudit(
      req.user,
      'AI_CHAT',
      'ai_chat',
      null,
      {
        mode: data?.mode || 'unknown',
        questionLength: message.length,
        scope: data?.scope || scope
      }
    );

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('[AI CHAT] fatal:', error);

    /*
     * Trả JSON rõ ràng thay vì để Express trả HTML 500.
     * Ở đây không bịa báo cáo nếu query CSDL thật sự hỏng.
     */
    return res.status(503).json({
      success: false,
      code: 'AI_CONTEXT_UNAVAILABLE',
      message:
        error?.message ||
        'Không đọc được dữ liệu báo cáo từ CSDL.',
      detail:
        process.env.NODE_ENV === 'development'
          ? String(error?.stack || '')
          : undefined
    });
  }
});

router.get('/report', async (req, res) => {
  const scope = normalizeScope(req.query || {});

  try {
    const data = await generateDailyReport(
      req.user,
      scope
    );

    await safeAudit(
      req.user,
      'AI_REPORT',
      'ai_report',
      null,
      {
        mode: data?.mode || 'unknown',
        scope: data?.scope || scope
      }
    );

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('[AI REPORT] fatal:', error);

    return res.status(503).json({
      success: false,
      code: 'AI_REPORT_UNAVAILABLE',
      message:
        error?.message ||
        'Không tạo được báo cáo từ CSDL.',
      detail:
        process.env.NODE_ENV === 'development'
          ? String(error?.stack || '')
          : undefined
    });
  }
});

router.post('/clean-transcript', async (req, res) => {
  const value = String(
    req.body?.text || ''
  ).trim();

  if (!value) {
    return res.status(400).json({
      success: false,
      message: 'Thiếu nội dung giọng nói'
    });
  }

  if (value.length > 2000) {
    return res.status(400).json({
      success: false,
      message: 'Nội dung giọng nói quá dài'
    });
  }

  try {
    const data = await cleanTranscriptAI(value);

    await safeAudit(
      req.user,
      'AI_TRANSCRIPT_CLEAN',
      'ai_transcript',
      null,
      {
        mode: data?.mode || 'unknown',
        textLength: value.length
      }
    );

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error(
      '[AI TRANSCRIPT CLEAN] fatal:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        'Không thể làm sạch nội dung giọng nói.'
    });
  }
});

router.post('/transcribe-audio', async (req, res) => {
  const audioBase64 = String(
    req.body?.audioBase64 || ''
  );
  const mimeType = String(
    req.body?.mimeType || 'audio/webm'
  );

  if (!audioBase64) {
    return res.status(400).json({
      success: false,
      message: 'Thiếu dữ liệu âm thanh'
    });
  }

  try {
    const data = await transcribeAudioAI(
      audioBase64,
      mimeType
    );

    await safeAudit(
      req.user,
      'AI_AUDIO_TRANSCRIBE',
      'ai_audio',
      null,
      {
        mode: data?.mode || 'unknown',
        model: data?.model || null,
        mimeType: data?.mimeType || mimeType,
        sizeBytes: data?.sizeBytes || 0
      }
    );

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error(
      '[AI AUDIO] transcribe failed:',
      error
    );

    const status =
      Number(error?.status) === 503
        ? 503
        : 500;

    return res.status(status).json({
      success: false,
      code:
        status === 503
          ? 'STT_UNAVAILABLE'
          : 'STT_ERROR',
      message:
        error?.message ||
        'Không thể chép lời từ âm thanh.'
    });
  }
});

export default router;
