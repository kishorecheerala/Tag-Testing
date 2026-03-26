import React, { useState, useRef, useEffect } from "react";
import { Search, Globe, Tag, Camera, ExternalLink, Copy, Check, AlertCircle, Loader2, Download, Scissors, Maximize2, X, Save } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactCrop, { type Crop, centerCrop, makeAspectCrop, PixelCrop } from "react-image-crop";

interface TestResult {
  success: boolean;
  title: string;
  finalUrl: string;
  screenshot: string;
  detectedTags: string[];
}

export default function App() {
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [mode, setMode] = useState<"url" | "snippet">("url");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Initializing analyzer...");
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [screenshotAction, setScreenshotAction] = useState<"none" | "copy" | "save" | "crop">("none");
  const [isCropping, setIsCropping] = useState(false);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [activeTab, setActiveTab] = useState<"screenshot" | "preview">("screenshot");
  const screenshotRef = useRef<HTMLImageElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "url" && !url) return;
    if (mode === "snippet" && !html) return;

    let formattedUrl = url;
    if (mode === "url" && !/^https?:\/\//i.test(url)) {
      formattedUrl = `https://${url}`;
    }

    setLoading(true);
    setStatusMessage("Checking server status...");
    setError(null);
    setResult(null);

    let statusInterval: any;

    try {
      // Check if server is reachable with retries
      let healthCheck = null;
      for (let i = 0; i < 3; i++) {
        try {
          healthCheck = await fetch("/api/health", { signal: AbortSignal.timeout(5000) });
          if (healthCheck.ok) break;
        } catch (e) {
          console.warn(`Health check attempt ${i + 1} failed`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!healthCheck || !healthCheck.ok) {
        throw new Error("The analysis server is not responding. This can happen if it's still starting up. Please wait 10 seconds and try again.");
      }

      setStatusMessage("Launching browser...");

      statusInterval = setInterval(() => {
        const messages = [
          "Navigating to content...",
          "Waiting for network idle...",
          "Detecting marketing tags...",
          "Capturing screenshot...",
          "Finalizing results...",
        ];
        setStatusMessage((prev) => {
          const currentIndex = messages.indexOf(prev);
          if (currentIndex < messages.length - 1) return messages[currentIndex + 1];
          return prev;
        });
      }, 3000);

      const response = await fetch("/api/test-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "url" ? { url: formattedUrl } : { html }),
        signal: AbortSignal.timeout(60000), // 60 second timeout for analysis
      });

      
      let data;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.error("Non-JSON response received:", text);
        throw new Error(`The analysis server is currently overloaded or unavailable (Status: ${response.status}). Please try again in a few moments.`);
      }

      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || "Failed to analyze the content. Please check your input and try again.");
      }
    } catch (err: any) {
      let errorMessage = "A network error occurred. Please make sure the server is running.";
      if (err.name === 'AbortError' || err.name === 'TimeoutError' || err.message?.includes('aborted')) {
        errorMessage = "The analysis timed out. The website might be too slow or blocking our automated browser.";
      } else if (err.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
      console.error(err);
    } finally {
      if (statusInterval) clearInterval(statusInterval);
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadScreenshot = () => {
    if (!result?.screenshot) return;
    const link = document.createElement("a");
    link.href = result.screenshot;
    link.download = `tag-tester-screenshot-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyImageToClipboard = async () => {
    if (!result?.screenshot) return;
    try {
      const response = await fetch(result.screenshot);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ]);
      setScreenshotAction("copy");
      setTimeout(() => setScreenshotAction("none"), 2000);
    } catch (err) {
      console.error("Failed to copy image:", err);
    }
  };

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    const initialCrop = centerCrop(
      makeAspectCrop(
        {
          unit: '%',
          width: 90,
        },
        1,
        width,
        height
      ),
      width,
      height
    );
    setCrop(initialCrop);
  };

  const saveCrop = async () => {
    if (!completedCrop || !imgRef.current || !result) return;

    const image = imgRef.current;
    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    canvas.width = completedCrop.width * scaleX;
    canvas.height = completedCrop.height * scaleY;

    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0,
      0,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY
    );

    const base64Image = canvas.toDataURL('image/png');
    setResult({ ...result, screenshot: base64Image });
    setIsCropping(false);
    setScreenshotAction("save");
    setTimeout(() => setScreenshotAction("none"), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500 selection:text-black">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <Tag className="text-black w-5 h-5" />
            </div>
            <span className="font-bold text-xl tracking-tight uppercase">Tag Tester <span className="text-orange-500">Pro</span></span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-white/60">
            <a href="#" className="hover:text-white transition-colors">Documentation</a>
            <a href="#" className="hover:text-white transition-colors">API Reference</a>
            <a href="#" className="hover:text-white transition-colors">Support</a>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl md:text-7xl font-black mb-6 tracking-tighter uppercase"
          >
            Audit Your <span className="text-orange-500">Marketing Tags</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-white/60 text-lg max-w-2xl mx-auto mb-10"
          >
            Test live URLs or raw HTML snippets to verify tag implementation and visual rendering.
          </motion.p>

          {/* Mode Switcher */}
          <div className="flex justify-center mb-8">
            <div className="bg-white/5 p-1 rounded-xl border border-white/10 flex gap-1">
              <button
                onClick={() => setMode("url")}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${mode === "url" ? "bg-orange-500 text-black" : "text-white/40 hover:text-white"}`}
              >
                URL Mode
              </button>
              <button
                onClick={() => setMode("snippet")}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${mode === "snippet" ? "bg-orange-500 text-black" : "text-white/40 hover:text-white"}`}
              >
                Snippet Mode
              </button>
            </div>
          </div>

          {/* Search Form */}
          <motion.form 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            onSubmit={handleTest}
            className="max-w-3xl mx-auto relative group"
          >
            {mode === "url" ? (
              <div className="relative flex items-center">
                <div className="absolute left-6 text-white/40 group-focus-within:text-orange-500 transition-colors">
                  <Search className="w-6 h-6" />
                </div>
                <input
                  type="text"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-white/5 border-2 border-white/10 rounded-2xl py-6 pl-16 pr-40 text-xl focus:outline-none focus:border-orange-500/50 focus:bg-white/10 transition-all placeholder:text-white/20"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !url}
                  className="absolute right-3 bg-orange-500 hover:bg-orange-400 disabled:bg-white/10 disabled:text-white/20 text-black font-bold py-3 px-8 rounded-xl transition-all flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {statusMessage}
                    </>
                  ) : (
                    "Run Test"
                  )}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative">
                  <textarea
                    placeholder="Paste your HTML tag snippet here (e.g., <script>...</script>)"
                    value={html}
                    onChange={(e) => setHtml(e.target.value)}
                    className="w-full bg-white/5 border-2 border-white/10 rounded-2xl py-6 px-6 text-lg focus:outline-none focus:border-orange-500/50 focus:bg-white/10 transition-all placeholder:text-white/20 min-h-[200px] font-mono"
                    disabled={loading}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !html}
                  className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-white/10 disabled:text-white/20 text-black font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {statusMessage}
                    </>
                  ) : (
                    "Analyze Snippet"
                  )}
                </button>
              </div>
            )}
          </motion.form>
        </div>

        {/* Results Section */}
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-3xl mx-auto bg-red-500/10 border border-red-500/20 rounded-2xl p-6 flex items-start gap-4 text-red-400"
            >
              <AlertCircle className="w-6 h-6 shrink-0" />
              <div>
                <h3 className="font-bold mb-1">Analysis Failed</h3>
                <p className="text-sm opacity-80">{error}</p>
              </div>
            </motion.div>
          )}

          {result && (
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              {/* Left Column: Info & Tags */}
              <div className="lg:col-span-5 space-y-8">
                {/* Page Info Card */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-8 space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">Page Title</label>
                    <h2 className="text-2xl font-bold leading-tight">{result.title || "No title found"}</h2>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">Final Destination URL</label>
                    <div className="flex items-center gap-2 p-3 bg-black/40 rounded-xl border border-white/5 group">
                      <Globe className="w-4 h-4 text-orange-500 shrink-0" />
                      <span className="text-sm truncate text-white/80">{result.finalUrl}</span>
                      <button 
                        onClick={() => copyToClipboard(result.finalUrl)}
                        className="ml-auto p-2 hover:bg-white/10 rounded-lg transition-colors"
                      >
                        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-white/40" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Detected Tags Card */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-8">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold uppercase tracking-tight flex items-center gap-2">
                      <Tag className="w-5 h-5 text-orange-500" />
                      Detected Tags
                    </h3>
                    <span className="bg-orange-500 text-black text-[10px] font-black px-2 py-1 rounded-full">
                      {result.detectedTags.length} FOUND
                    </span>
                  </div>

                  {result.detectedTags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {result.detectedTags.map((tag) => (
                        <div 
                          key={tag}
                          className="bg-white/10 hover:bg-white/20 border border-white/5 px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
                        >
                          <div className="w-2 h-2 bg-orange-500 rounded-full" />
                          {tag}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 border-2 border-dashed border-white/5 rounded-2xl">
                      <p className="text-white/40 text-sm italic">No common marketing tags detected.</p>
                    </div>
                  )}
                </div>

                {/* Quick Actions */}
                <div className="flex gap-4">
                  <a 
                    href={result.finalUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all"
                  >
                    <ExternalLink className="w-5 h-5" />
                    Open Live Site
                  </a>
                </div>
              </div>

              {/* Right Column: Screenshot & Preview */}
              <div className="lg:col-span-7">
                <div className="bg-white/5 border border-white/10 rounded-3xl p-4 h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4 px-4 pt-2">
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setActiveTab("screenshot")}
                        className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === "screenshot" ? "text-orange-500" : "text-white/40 hover:text-white"}`}
                      >
                        <Camera className="w-4 h-4" />
                        Screenshot
                      </button>
                      <button
                        onClick={() => setActiveTab("preview")}
                        className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === "preview" ? "text-orange-500" : "text-white/40 hover:text-white"}`}
                      >
                        <Globe className="w-4 h-4" />
                        Live Preview
                      </button>
                    </div>
                    
                    <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                      {activeTab === "preview" ? null : isCropping ? (
                        <>
                          <button
                            onClick={saveCrop}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors group relative text-green-500"
                            title="Save Crop"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setIsCropping(false)}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors group relative text-red-500"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setIsCropping(true)}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors group relative"
                            title="Crop Image"
                          >
                            <Scissors className="w-4 h-4 text-white/40 group-hover:text-white" />
                          </button>
                          <button
                            onClick={copyImageToClipboard}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors group relative"
                            title="Copy Image"
                          >
                            {screenshotAction === "copy" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-white/40 group-hover:text-white" />}
                          </button>
                          <button
                            onClick={downloadScreenshot}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors group relative"
                            title="Download Image"
                          >
                            <Download className="w-4 h-4 text-white/40 group-hover:text-white" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex-1 relative rounded-2xl overflow-hidden border border-white/5 bg-black min-h-[400px] flex items-center justify-center">
                    <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
                      {activeTab === "preview" ? (
                        <iframe 
                          src={mode === "url" ? url : undefined}
                          srcDoc={mode === "snippet" ? html : undefined}
                          className="w-full h-full bg-white rounded-xl border-0"
                          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
                          title="Live Preview"
                        />
                      ) : isCropping ? (
                        <ReactCrop
                          crop={crop}
                          onChange={(c) => setCrop(c)}
                          onComplete={(c) => setCompletedCrop(c)}
                          className="max-w-full"
                        >
                          <img 
                            ref={imgRef}
                            src={result.screenshot} 
                            alt="Crop Preview" 
                            onLoad={onImageLoad}
                            className="max-w-full h-auto object-contain"
                            referrerPolicy="no-referrer"
                          />
                        </ReactCrop>
                      ) : (
                        <img 
                          ref={screenshotRef}
                          src={result.screenshot} 
                          alt="Page Screenshot" 
                          className="max-w-full h-auto object-contain shadow-2xl"
                          referrerPolicy="no-referrer"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-12 border-t border-white/10 text-center">
        <p className="text-white/20 text-sm uppercase tracking-[0.2em] font-bold">
          &copy; 2026 Tag Tester Pro &bull; Built for Performance
        </p>
      </footer>
    </div>
  );
}
