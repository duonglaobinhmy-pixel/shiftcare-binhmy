import express from 'express';

console.log('1. express imported');

const app = express();

console.log('2. app created');

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

console.log('3. route created');

app.listen(8788, '127.0.0.1', () => {
  console.log('4. listening http://127.0.0.1:8788');
});
