import express from "express";
import { createServer as createViteServer } from "vite";
import puppeteer from "puppeteer";
import cors from "cors";
import path from "path";
let cachedBrowser: puppeteer.Browser | null = null;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API endpoint for tag testing
  app.post("/api/test-tag", async (req, res) => {
    let { url, html } = req.body;

    if (!url && !html) {
      return res.status(400).json({ error: "URL or HTML snippet is required" });
    }

    if (url) {
      // Basic URL formatting
      if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
      }

      // Validate URL
      try {
        new URL(url);
      } catch (e) {
        return res.status(400).json({ error: "Invalid URL format" });
      }
    }

    let page: puppeteer.Page | null = null;
    try {
      if (!cachedBrowser || !cachedBrowser.isConnected()) {
        console.log("Launching new browser instance...");
        cachedBrowser = await puppeteer.launch({
          args: [
            "--no-sandbox", 
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--disable-gpu",
            "--window-size=1280,800"
          ],
          headless: true,
        });
      }

      page = await cachedBrowser.newPage();
      
      // Log page errors
      page.on('error', err => console.error('Page error:', err));
      page.on('pageerror', err => console.error('Page script error:', err));
      
      // Set a realistic user agent
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      
      // Set a timeout for the entire page operation
      page.setDefaultTimeout(45000);
      
      // Set a reasonable viewport
      await page.setViewport({ width: 1280, height: 800 });
      
      const detectedTags: string[] = [];
      const networkLogs: string[] = [];
      const tagPatterns = [
        { name: "Google Tag Manager", pattern: /googletagmanager\.com\/gtm\.js/ },
        { name: "Google Analytics 4", pattern: /googletagmanager\.com\/gtag\/js/ },
        { name: "Facebook Pixel", pattern: /connect\.facebook\.net\/.*\/fbevents\.js/ },
        { name: "TikTok Pixel", pattern: /analytics\.tiktok\.com\/i18n\/pixel\/sdk\.js/ },
        { name: "Hotjar", pattern: /static\.hotjar\.com/ },
        { name: "LinkedIn Insight", pattern: /snap\.licdn\.com\/li\.lms-analytics\/insight\.min\.js/ },
        { name: "Pinterest Tag", pattern: /s\.pinimg\.com\/ct\/core\.js/ },
        { name: "Snap Pixel", pattern: /sc-static\.net\/scevent\.min\.js/ },
        { name: "HubSpot", pattern: /js\.hs-scripts\.com/ },
        { name: "DoubleClick/DCM", pattern: /googletagservices\.com\/dcm/ },
        { name: "VAST/VPAID", pattern: /vast|vpaid/i },
        { name: "AppNexus", pattern: /adnxs\.com/ },
        { name: "The Trade Desk", pattern: /adsrvr\.org/ },
        { name: "Criteo", pattern: /criteo\.com/ },
      ];

      page.on("request", (request) => {
        const reqUrl = request.url();
        networkLogs.push(reqUrl);
        tagPatterns.forEach((tag) => {
          if (tag.pattern.test(reqUrl) && !detectedTags.includes(tag.name)) {
            detectedTags.push(tag.name);
          }
        });
      });

      if (url) {
        // Navigate to the URL
        console.log(`Navigating to URL: ${url}`);
        await page.goto(url, { waitUntil: "load", timeout: 20000 });
      } else if (html) {
        // Load raw HTML using setContent
        console.log("Loading HTML snippet...");
        await page.setContent(html, { 
          waitUntil: "domcontentloaded", 
          timeout: 15000 
        });
        // Wait a bit for dynamic content
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Capture final URL (after redirects)
      let finalUrl = page.url();

      if (html) {
        finalUrl = "Manual click required (Test in Live Preview)";
      }

      // Wait a bit for ad to load
      await new Promise(resolve => setTimeout(resolve, html ? 500 : 1000));

      // Capture screenshot
      let screenshot: string;
      try {
        console.log("Capturing screenshot...");
        let adBox = null;
        
        if (html) {
          // Expanded selectors for common ad tags and containers
          adBox = await page.evaluate(() => {
            const adSelectors = [
              'ins.adsbygoogle',
              'iframe[id*="google_ads_iframe"]',
              'iframe[src*="doubleclick"]',
              'iframe[src*="adservice"]',
              '.dcmads',
              '[id*="ad-container"]',
              '[class*="ad-container"]',
              'ins',
              'iframe',
              '[id*="ad"]',
              '[class*="ad"]',
              '#ad',
              '.ad'
            ];
            
            for (const selector of adSelectors) {
              const el = document.querySelector(selector);
              if (el) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 10 && rect.height > 10) {
                  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                }
              }
            }
            return null;
          });
        }

        if (adBox) {
          // For snippets, try to capture just the ad
          screenshot = await page.screenshot({ encoding: "base64", clip: adBox, timeout: 10000 }) as string;
        } else {
          // Fallback to full viewport
          screenshot = await page.screenshot({ encoding: "base64", fullPage: false, timeout: 10000 }) as string;
        }
      } catch (e) {
        console.error("Screenshot error, falling back to page screenshot:", e);
        try {
          screenshot = await page.screenshot({ encoding: "base64", fullPage: false, timeout: 5000 }) as string;
        } catch (innerError) {
          console.error("Critical screenshot failure:", innerError);
          screenshot = ""; // Empty string as last resort
        }
      }

      // Capture page title
      const title = await page.title();

      if (page) await page.close();

      res.json({
        success: true,
        title: title || (html ? "HTML Snippet Test" : "No title found"),
        finalUrl,
        screenshot: `data:image/png;base64,${screenshot}`,
        detectedTags,
      });
    } catch (error: any) {
      if (page) await page.close().catch(() => {});
      console.error("Puppeteer error:", error);
      res.status(500).json({ error: "Failed to analyze content", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
