/**
 * Local mock When2meet for manual testing: `npm run mock`, then open
 * http://localhost:8787/?1000001-DATES (specific dates) or http://localhost:8787/?1000002-WEEKS.
 *
 * Use with a development build of the extension that also matches localhost:
 * `W2M_DEV_HOSTS=1 npm run dev`.
 */
import { createServer } from 'node:http';
import { createMockWhen2meet } from './mock.ts';
import { SEED_POLLS, seedPolls } from './seed.ts';

const port = Number(process.env.PORT ?? 8787);
const mock = createMockWhen2meet(seedPolls(), {
  saveSemantics: process.env.SAVE_SEMANTICS === 'slots' ? 'slots' : 'availability',
});

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);

  if (url.pathname === '/__mock/log') {
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(mock.log, null, 2));
    return;
  }
  if (url.pathname === '/__mock/config' && req.method === 'POST') {
    mock.configure(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(mock.config));
    return;
  }

  const response = await mock.handle({
    method: req.method ?? 'GET',
    url: url.href,
    body: Buffer.concat(chunks).toString('utf8'),
  });
  res.writeHead(response.status, response.headers).end(response.body);
});

server.listen(port, () => {
  console.log(`Mock When2meet on http://localhost:${port}`);
  console.log(
    `  Specific dates: http://localhost:${port}/?${SEED_POLLS.dates.id}-${SEED_POLLS.dates.code}`,
  );
  console.log(
    `  Days of week:   http://localhost:${port}/?${SEED_POLLS.weekdays.id}-${SEED_POLLS.weekdays.code}`,
  );
  console.log(`  Request log:    http://localhost:${port}/__mock/log`);
});
