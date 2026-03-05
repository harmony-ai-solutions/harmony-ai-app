// Smoke test: verify Appium MCP server is reachable
// Requires: appium server running (npm run appium:start)
import http from 'http';

function pingAppium(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(`http://${host}:${port}/status`, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

describe('Appium MCP Connectivity', () => {
  const host = process.env.APPIUM_HOST || '127.0.0.1';
  const port = Number(process.env.APPIUM_PORT) || 4723;

  it('Appium server should be reachable on port 4723', async () => {
    const reachable = await pingAppium(host, port);
    expect(reachable).toBe(true);
  }, 10_000);
});