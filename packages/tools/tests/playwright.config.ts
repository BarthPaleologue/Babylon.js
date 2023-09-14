import { defineConfig, devices } from "@playwright/test";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    testDir: "./test/playwright",
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 1,
    /* Opt out of parallel tests on CI. */
    workers: process.env.CI ? 1 : undefined,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: process.env.CI ? 'dot' : "html",
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Base URL to use in actions like `await page.goto('/')`. */
        // baseURL: 'http://127.0.0.1:3000',

        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: "on-first-retry",
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: "webgl2",
            testMatch: "**/*webgl2.test.ts",
            use: {
                ...devices[process.env.CI ? "Desktop Firefox" : "Desktop Chrome"],
                launchOptions: {
                    args: [process.env.CI ? "-wait-for-browser" : "--use-angle=default"],
                },
            },
        },

        {
            name: "webgl1",
            testMatch: "**/*webgl1.test.ts",
            use: {
                ...devices[process.env.CI ? "Desktop Firefox" : "Desktop Chrome"],
                launchOptions: {
                    args: [process.env.CI ? "-wait-for-browser" : "--use-angle=default"],
                },
            },
        },

        {
            name: "webgpu",
            testMatch: "**/*webgpu.test.ts",
            use: {
                ...devices["Desktop Chrome"],
                launchOptions: {
                    args: ["--use-angle=default", ...(process.env.CUSTOM_FLAGS ? process.env.CUSTOM_FLAGS.split(" ") : [])],
                },
            },
        },

        {
            name: "CI",
            testMatch: "**/*webgl*.test.ts",
            use: {
                ...devices["Desktop Firefox"],
                launchOptions: {
                    args: ["-wait-for-browser"],
                },
            },
        },

        /* Test against mobile viewports. */
        // {
        //   name: 'Mobile Chrome',
        //   use: { ...devices['Pixel 5'] },
        // },
        // {
        //   name: 'Mobile Safari',
        //   use: { ...devices['iPhone 12'] },
        // },

        /* Test against branded browsers. */
        // {
        //   name: 'Microsoft Edge',
        //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
        // },
        // {
        //   name: 'Google Chrome',
        //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
        // },
    ],

    snapshotPathTemplate: "test/visualization/ReferenceImages/{arg}{ext}",

    /* Run your local dev server before starting the tests */
    // webServer: {
    //   command: 'npm run start',
    //   url: 'http://127.0.0.1:1337',
    //   reuseExistingServer: !process.env.CI,
    // },
});

