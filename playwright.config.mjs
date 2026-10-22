import { defineConfig } from "@playwright/test";

if (process.env.LOCAL_TEST_EMULATORS !== "1" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
    || !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.LOCAL_TEST_BASE_URL || "")) {
    throw new Error("Execute npm run test:e2e: somente o ambiente demo isolado é permitido.");
}
export default defineConfig({
    testDir: "./e2e", workers: 1, retries: 0, maxFailures: 1, timeout: 60_000,
    expect: { timeout: 15_000 }, reporter: "list",
    outputDir: `${process.env.LOCAL_TEST_OUTPUT}/browser-results`,
    use: { baseURL: process.env.LOCAL_TEST_BASE_URL, trace: "retain-on-failure" },
    projects: process.platform === "win32"
        ? ["msedge", "chrome"].map((channel) => ({ name: channel, use: { channel } }))
        : [{ name: "chromium", use: { browserName: "chromium" } }]
});
