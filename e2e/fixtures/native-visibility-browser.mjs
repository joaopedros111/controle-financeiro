import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function executable(channel) {
    if (!channel || channel === 'chromium') return chromium.executablePath();
    if (process.platform !== 'win32' || !['chrome', 'msedge'].includes(channel)) throw new Error('Unsupported native visibility channel');
    const suffix = channel === 'msedge' ? ['Microsoft', 'Edge', 'Application', 'msedge.exe'] : ['Google', 'Chrome', 'Application', 'chrome.exe'];
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
        const candidate = path.join(root, ...suffix);
        try { await access(candidate); return candidate; } catch {}
    }
    throw new Error(`Native visibility browser not installed: ${channel}`);
}

// Playwright's normal page session enables focus emulation and forces visibility.
// A separate CDP session cannot clear that session's override. Use a fresh,
// synthetic default context with the documented noDefaults connection instead:
// https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp-option-no-defaults
export async function nativeVisibilityBrowser(channel) {
    if (process.env.LOCAL_TEST_EMULATORS !== '1' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.LOCAL_TEST_BASE_URL || '')) {
        throw new Error('Native visibility fixture requires isolated loopback QA');
    }
    const binary = await executable(channel);
    const profile = await mkdtemp(path.join(tmpdir(), 'cf-native-visibility-'));
    const log = createWriteStream(path.join(profile, 'browser.log'));
    const child = spawn(binary, ['--headless=new', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
        '--no-sandbox', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
        '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.pipe(log);
    let startupError, browser;
    child.on('error', error => { startupError = error; log.end(); });
    const exited = new Promise(resolve => child.once('exit', resolve));
    const close = async () => {
        if (browser) {
            try { await (await browser.newBrowserCDPSession()).send('Browser.close'); } catch {}
            await browser.close().catch(() => {});
        }
        if (child.pid && child.exitCode === null) {
            await Promise.race([exited, delay(3000, null, { ref: false }).then(() => { if (child.exitCode === null) child.kill(); })]);
        }
    };
    try {
        const deadline = Date.now() + 15_000;
        let endpoint;
        while (!endpoint && Date.now() < deadline) {
            if (startupError) throw startupError;
            if (child.exitCode !== null) throw new Error(`Native browser exited during startup (${child.exitCode}); see ${profile}`);
            try {
                const [port, target] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
                if (/^\d+$/.test(port) && /^\/devtools\/browser\/[\w-]+$/.test(target)) endpoint = `ws://127.0.0.1:${port}${target}`;
            } catch (error) { if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error; }
            if (!endpoint) await delay(25);
        }
        if (!endpoint) throw new Error(`Native browser startup deadline exceeded; see ${profile}`);
        browser = await chromium.connectOverCDP(endpoint, { noDefaults: true, timeout: 15_000 });
        return { browser, context: browser.contexts()[0], profile, close };
    } catch (error) { await close(); throw error; }
}
