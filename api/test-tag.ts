import type { VercelRequest, VercelResponse } from '@vercel/node';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

let cachedBrowser: puppeteer.Browser | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let { url, html, deviceType = "desktop" } = req.body;

  if (!url && !html) {
    return res.status(400).json({ error: "URL or HTML snippet is required" });
  }

  if (url) {
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format" });
    }
  }

  let page: puppeteer.Page | null = null;
  try {
    if (!cachedBrowser || !cachedBrowser.isConnected()) {
      // Configure chromium for serverless environment
      chromium.setGraphicsMode = false;
      
      cachedBrowser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    }

    page = await cachedBrowser.newPage();
    
    page.on('error', err => console.error('Page error:', err));
    page.on('pageerror', err => console.error('Page script error:', err));
    
    if (deviceType === "mobile") {
      await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1");
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    } else {
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      await page.setViewport({ width: 1280, height: 800 });
    }
    
    page.setDefaultTimeout(45000);
    
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
      console.log(`Navigating to URL: ${url}`);
      await page.goto(url, { waitUntil: "load", timeout: 20000 });
    } else if (html) {
      console.log("Loading HTML snippet...");
      await page.setContent(html, { 
        waitUntil: "domcontentloaded", 
        timeout: 15000 
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    let finalUrl = page.url();
    if (html) {
      const hrefMatch = html.match(/href=["'](.*?)["']/i);
      if (hrefMatch && hrefMatch[1]) {
        finalUrl = hrefMatch[1];
      } else {
        finalUrl = "No destination URL found in snippet";
      }
    }

    await new Promise(resolve => setTimeout(resolve, html ? 500 : 1000));

    let screenshot: string;
    try {
      console.log("Capturing screenshot...");
      let adBox = null;

      if (html) {
        adBox = await page.evaluate(() => {
          const adSelectors = [
            'ins.adsbygoogle', 'iframe[id*="google_ads_iframe"]', 'iframe[src*="doubleclick"]',
            'iframe[src*="adservice"]', '.dcmads', '[id*="ad-container"]', '[class*="ad-container"]',
            'ins', 'iframe', '[id*="ad"]', '[class*="ad"]', '#ad', '.ad'
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
        screenshot = await page.screenshot({ encoding: "base64", clip: adBox, timeout: 10000 }) as string;
      } else {
        screenshot = await page.screenshot({ encoding: "base64", fullPage: false, timeout: 10000 }) as string;
      }
    } catch (e) {
      console.error("Screenshot error, falling back to page screenshot:", e);
      try {
        screenshot = await page.screenshot({ encoding: "base64", fullPage: false, timeout: 5000 }) as string;
      } catch (innerError) {
        console.error("Critical screenshot failure:", innerError);
        screenshot = "";
      }
    }

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
}
