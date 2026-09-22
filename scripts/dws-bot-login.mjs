import { spawn } from 'node:child_process';

const clientId = process.env.DINGTALK_CLIENT_ID;
const clientSecret = process.env.DINGTALK_CLIENT_SECRET;
const robotCode = process.env.DINGTALK_ROBOT_CODE;

if (!clientId || !clientSecret || !robotCode) {
  console.error('DingTalk robot application credentials are not completely loaded from .env');
  process.exit(2);
}

console.log(JSON.stringify({
  configurationLoaded: true,
  oauthClient: 'dws-managed',
  robotCodeMatchesClientId: robotCode === clientId,
  clientIdLength: clientId.length,
  clientSecretLength: clientSecret.length,
  secretsPrinted: false
}));

const child = spawn('dws', [
  'auth', 'login', '--device', '--no-browser', '--recommend',
  '--format', 'json'
], { stdio: 'inherit' });

child.once('error', (error) => {
  console.error('Unable to start DWS:', error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
